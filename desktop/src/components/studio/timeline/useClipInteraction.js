import { useCallback, useRef, useEffect } from "react";

const SNAP_THRESHOLD_PX = 8;

/**
 * useClipInteraction — centralize select + drag cho mọi loại clip.
 * Ai dùng chỉ cần spread `{...handlers}` vào div ngoài cùng của clip.
 *
 * selection, setSelection lấy từ Timeline state.
 */
export default function useClipInteraction({
  clip, track, tracks, selection, setSelection,
  pxPerSecond, snapEnabled, playhead, duration,
  setClipStart, setSnapGuide, commit,
  trackAreaRef, moveClipToTrack, addTrack, cleanupTracks,
}) {
  const startedAt = useRef(null);
  // Luôn trỏ tới tracks mới nhất để closure trong onMove đọc được state sau update.
  const tracksRef = useRef(tracks);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);

  const isSelected = selection.has(clip.id);

  const onMouseDown = useCallback(
    (e) => {
      if (track.locked) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      // Select ngay khi mousedown — giống CapCut
      const shift = e.shiftKey;
      let next;
      if (shift) {
        next = new Set(selection);
        if (next.has(clip.id)) next.delete(clip.id);
        else next.add(clip.id);
      } else if (!isSelected) {
        next = new Set([clip.id]);
      } else {
        next = selection;
      }
      setSelection(Array.from(next));

      // Chuẩn bị drag
      startedAt.current = {
        mx: e.clientX,
        my: e.clientY,
        originalStart: clip.start,
        originalTrackId: track.id,
      };
      let moved = false;
      let currentTrackId = track.id;
      // Pending spawn: nếu user thả chuột ngoài cụm cùng loại → commit ở mouseup.
      // { dir: 'above'|'below' } | null
      let pendingSpawn = null;

      // Giúp tìm track-id tại tọa độ Y hiện tại trong vùng scroller.
      const findTrackAt = (clientY) => {
        if (!trackAreaRef?.current) return null;
        const rect = trackAreaRef.current.getBoundingClientRect();
        const localY = clientY - rect.top + trackAreaRef.current.scrollTop;
        let y = 0;
        for (const t of tracksRef.current) {
          const h = t.height || 48;
          if (localY >= y && localY < y + h) return t;
          y += h;
        }
        return null;
      };
      // Mapping clip.type (video/audio/subtitle) → track.kind chấp nhận
      const compatibleKind = (kind) => kind === clip.type
        || (clip.type === "subtitle" && kind === "subtitle")
        || (clip.type === "text" && kind === "subtitle");

      const onMove = (ev) => {
        const d = startedAt.current;
        if (!d) return;
        // An toàn: nếu clip đã bị xóa khỏi state → dừng drag ngay, không
        // tiếp tục dispatch setClipStart/moveClipToTrack với clip không tồn tại.
        const liveClip = tracksRef.current
          .flatMap((t) => t.clips.map((c) => ({ c, tid: t.id })))
          .find(({ c }) => c.id === clip.id);
        if (!liveClip) return;
        // Cập nhật duration thực từ state (phòng trường hợp user trim xong rồi kéo)
        const liveDuration = liveClip.c.duration;
        const dxPx = ev.clientX - d.mx;
        if (!moved && Math.abs(dxPx) < 3) return;
        if (!moved) {
          // First real movement — snapshot current state for undo.
          commit?.();
        }
        moved = true;

        const rawStart = d.originalStart + dxPx / pxPerSecond;
        let snappedStart = rawStart;
        let guideTime = null;

        if (snapEnabled) {
          const clipEndRaw = rawStart + liveDuration;
          const candidates = [0, duration, playhead];
          for (const t of tracksRef.current) {
            for (const c of t.clips) {
              if (c.id === clip.id) continue;
              candidates.push(c.start, c.start + c.duration);
            }
          }
          const thresholdSec = SNAP_THRESHOLD_PX / pxPerSecond;
          let best = null;
          for (const cand of candidates) {
            const toStart = Math.abs(cand - rawStart);
            const toEnd = Math.abs(cand - clipEndRaw);
            if (toStart < thresholdSec && (!best || toStart < best.dist)) {
              best = { start: cand, dist: toStart, guide: cand };
            }
            if (toEnd < thresholdSec && (!best || toEnd < best.dist)) {
              best = { start: cand - liveDuration, dist: toEnd, guide: cand };
            }
          }
          if (best) {
            snappedStart = best.start;
            guideTime = best.guide;
          }
        }

        // Va chạm — trong cùng track, không cho clip đè lên clip khác.
        // Clamp vào gap hợp lệ gần nhất. currentTrackId luôn sync với track
        // hiện tại của clip (cập nhật lại nếu đã bị move đâu đó).
        const realTrackId = liveClip.tid;
        if (realTrackId !== currentTrackId) currentTrackId = realTrackId;
        const curTrack = tracksRef.current.find((t) => t.id === currentTrackId);
        if (curTrack) {
          snappedStart = clampToFreeGap(
            clip.id,
            curTrack,
            Math.max(0, snappedStart),
            liveDuration
          );
        }

        setClipStart(clip.id, Math.max(0, snappedStart));
        setSnapGuide(guideTime);

        // Di chuyển dọc kiểu CapCut — logic:
        //   A) Chuột trên track cùng loại khác → nhảy sang ngay
        //   B) Chuột ngoài cụm cùng loại → ĐÁNH DẤU pendingSpawn, không commit
        //      (commit ở mouseup để tránh spawn liên tục)
        if (moveClipToTrack && trackAreaRef?.current) {
          const rect = trackAreaRef.current.getBoundingClientRect();
          const localY = ev.clientY - rect.top + trackAreaRef.current.scrollTop;

          let y = 0;
          let sameKindTop = null, sameKindBot = null;
          for (const t of tracksRef.current) {
            const h = t.height || 48;
            if (compatibleKind(t.kind)) {
              if (sameKindTop == null) sameKindTop = y;
              sameKindBot = y + h;
            }
            y += h;
          }

          const over = findTrackAt(ev.clientY);
          if (over && over.id !== currentTrackId && compatibleKind(over.kind) && !over.locked) {
            moveClipToTrack(clip.id, over.id);
            currentTrackId = over.id;
            pendingSpawn = null;
          } else if (sameKindTop != null) {
            const SPAWN_THRESHOLD = 24;
            if (localY < sameKindTop - SPAWN_THRESHOLD) {
              pendingSpawn = { dir: "above" };
            } else if (localY > sameKindBot + SPAWN_THRESHOLD) {
              pendingSpawn = { dir: "below" };
            } else {
              pendingSpawn = null;
            }
          }
        }
      };

      const onUp = () => {
        startedAt.current = null;
        setSnapGuide(null);

        if (pendingSpawn && addTrack && moveClipToTrack) {
          // Commit spawn khi thả chuột — chỉ 1 lần / session.
          const label =
            clip.type === "subtitle" ? "Text"
            : clip.type === "audio" ? "Audio"
            : "Video";
          const newId = `${label[0]}${Date.now().toString(36).slice(-3)}`;
          addTrack(clip.type === "subtitle" ? "subtitle" : clip.type, {
            id: newId, label, position: pendingSpawn.dir,
          });
          setTimeout(() => moveClipToTrack(clip.id, newId), 0);
        }
        // KHÔNG cleanup ở đây — chỉ cleanup khi user explicit delete.
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [
      clip, track, tracks, selection, isSelected,
      pxPerSecond, snapEnabled, playhead, duration,
      setSelection, setClipStart, setSnapGuide, commit,
      trackAreaRef, moveClipToTrack, addTrack,
    ]
  );

  return { isSelected, onMouseDown };
}

/**
 * clampToFreeGap — nếu proposed đè clip khác cùng track, clamp SÁT mép
 * clip đang va chạm (không "nhảy" xa đến gap khác). Không va chạm → giữ
 * nguyên, clip được phép có gap tự do giữa các clip khác.
 */
function clampToFreeGap(clipId, track, proposed, duration) {
  const others = (track.clips || []).filter((c) => c.id !== clipId);
  if (others.length === 0) return Math.max(0, proposed);

  // Lặp tối đa 3 lần để xử lý va chạm dây chuyền
  let start = Math.max(0, proposed);
  for (let i = 0; i < 3; i++) {
    const end = start + duration;
    const blocking = others.find(
      (c) => start < c.start + c.duration && end > c.start
    );
    if (!blocking) return start;

    const pMid = start + duration / 2;
    const bMid = blocking.start + blocking.duration / 2;
    if (pMid < bMid) {
      // Đặt ngay sát trái của clip chắn
      start = Math.max(0, blocking.start - duration);
    } else {
      // Đặt ngay sát phải của clip chắn
      start = blocking.start + blocking.duration;
    }
  }
  return Math.max(0, start);
}
