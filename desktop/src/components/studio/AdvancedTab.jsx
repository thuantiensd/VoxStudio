import { useRef, useState, useEffect, useCallback } from "react";
import { dubbingVideoURL } from "../../services/api";
import SubtitleOverlay from "../dubbing/SubtitleOverlay";
import Timeline from "./timeline/Timeline";
import { useTimelineState } from "./timeline/useTimelineState";

const DEFAULT_STYLE = {
  font_family: "Arial", font_size: 24, font_color: "#FFFFFF",
  font_bold: false, font_italic: false,
  bg_color: "#000000", bg_opacity: 0.6,
  outline_color: "#000000", outline_width: 2, shadow_offset: 0,
  position: "bottom", margin_v: 30,
};

/**
 * AdvancedTab — preview + timeline CapCut-style, playback theo layout clips.
 *
 * Chiến lược mượt:
 *   - Dùng CHÍNH <video> native làm nguồn phát (không RAF seek mỗi frame).
 *   - `timeupdate` → map video.currentTime (source time) → playhead (timeline time).
 *   - Khi video đạt cuối sourceStart+duration của clip hiện tại → seek sang
 *     sourceStart của clip kế tiếp, set playhead = nextClip.start.
 *   - User scrub: cập nhật playhead + seek video tới source tương ứng.
 *   - Audio của video không mute → user nghe trực tiếp.
 */
export default function AdvancedTab({ project }) {
  const { state, actions } = useTimelineState(project);
  const videoRef = useRef(null);
  const currentClipRef = useRef(null);    // clip V1 đang phát
  const userSeekingRef = useRef(false);   // đánh dấu lúc seek chủ động để timeupdate không loop
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);

  const style = project.subtitle_style || DEFAULT_STYLE;
  const showSubs = project.enable_subtitle ?? true;

  const videoClips = (state.tracks.find((t) => t.kind === "video")?.clips || [])
    .slice()
    .sort((a, b) => a.start - b.start);

  const findVideoClipAt = useCallback(
    (t) => videoClips.find((c) => t >= c.start && t < c.start + c.duration),
    [videoClips]
  );
  const findNextVideoClip = useCallback(
    (afterTime) => videoClips.find((c) => c.start >= afterTime),
    [videoClips]
  );

  const liveSegments = (state.tracks.find((t) => t.kind === "subtitle")?.clips || [])
    .map((c) => ({
      id: c.segmentId || c.id,
      start: c.start,
      end: c.start + c.duration,
      translated_text: c.text,
    }));

  // Seek video → source time của playhead trong clip hiện tại.
  const syncVideoToPlayhead = useCallback((t) => {
    const v = videoRef.current;
    if (!v) return;
    const clip = findVideoClipAt(t);
    currentClipRef.current = clip || null;
    if (!clip) {
      if (!v.paused) v.pause();
      return;
    }
    const target = (clip.sourceStart || 0) + (t - clip.start);
    userSeekingRef.current = true;
    v.currentTime = Math.max(0, target);
    // timeupdate fires several times after seek; reset flag shortly after.
    setTimeout(() => { userSeekingRef.current = false; }, 50);
  }, [findVideoClipAt]);

  // Khi user scrub → sync video ngay
  const handleSeek = useCallback((t) => {
    const clamped = Math.max(0, t);
    setPlayhead(clamped);
    syncVideoToPlayhead(clamped);
  }, [syncVideoToPlayhead]);

  // Listen video timeupdate → update playhead map ngược
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      if (userSeekingRef.current) return;
      const clip = currentClipRef.current;
      if (!clip) return;
      const srcT = v.currentTime;
      const srcEnd = (clip.sourceStart || 0) + clip.duration;
      if (srcT >= srcEnd - 0.02) {
        // Hết clip hiện tại → jump sang clip kế trên timeline
        const nextClip = findNextVideoClip(clip.start + clip.duration);
        if (nextClip) {
          currentClipRef.current = nextClip;
          userSeekingRef.current = true;
          v.currentTime = nextClip.sourceStart || 0;
          setPlayhead(nextClip.start);
          setTimeout(() => { userSeekingRef.current = false; }, 50);
        } else {
          v.pause();
          setPlaying(false);
          setPlayhead(clip.start + clip.duration);
        }
      } else {
        // Map source → timeline
        setPlayhead(clip.start + (srcT - (clip.sourceStart || 0)));
      }
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("pause", onPause);
    v.addEventListener("play", onPlay);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("play", onPlay);
    };
  }, [findNextVideoClip]);

  const handleTogglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // Đảm bảo video đang ở đúng source trước khi play
      syncVideoToPlayhead(playhead);
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [playhead, syncVideoToPlayhead]);

  // Nếu tracks đổi trong khi đang play (user split/move clip) → re-sync
  useEffect(() => {
    if (!playing) return;
    syncVideoToPlayhead(playhead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tracks]);

  return (
    <div className="h-full flex flex-col"
         style={{ background: "var(--bg-primary)" }}>
      {/* Preview */}
      <div className="flex-1 min-h-0 flex items-center justify-center"
           style={{ background: "#000" }}>
        <div className="relative" style={{ maxWidth: "100%", maxHeight: "100%" }}>
          <video
            ref={videoRef}
            src={dubbingVideoURL(project.id)}
            className="rounded"
            style={{ maxWidth: "100%", maxHeight: "50vh" }}
            onClick={handleTogglePlay}
          />
          {showSubs && (
            <SubtitleOverlay
              segments={liveSegments}
              currentTime={playhead}
              style={style}
            />
          )}
        </div>
      </div>

      {/* Timeline */}
      <div style={{ height: "42vh", minHeight: 260 }}>
        <Timeline
          project={project}
          state={state}
          actions={actions}
          playhead={playhead}
          playing={playing}
          onSeek={handleSeek}
          onTogglePlay={handleTogglePlay}
        />
      </div>
    </div>
  );
}
