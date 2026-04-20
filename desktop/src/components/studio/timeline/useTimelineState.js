import { useReducer, useCallback, useMemo } from "react";

/**
 * Dữ liệu chuẩn hóa clip (spec trong cuộc nói chuyện thiết kế):
 *   {
 *     id, trackId, type: "video"|"audio"|"text"|"subtitle",
 *     start: number,          // giây trên timeline
 *     duration: number,
 *     sourceStart?: number,   // offset trong file gốc (sau trim trái)
 *     sourceUrl?: string,
 *     text?: string,          // subtitle/text
 *     voiceId?: string,
 *     volume?: number, muted?: boolean, speed?: number,
 *   }
 */

const MIN_PX_PER_SEC = 8;
const MAX_PX_PER_SEC = 200;
const DEFAULT_PX_PER_SEC = 40;

const HISTORY_MAX = 30;

// Chỉ snapshot những field restore được qua undo — bỏ qua playhead/scroll.
function snapshot(s) {
  return {
    tracks: s.tracks,
    selection: new Set(s.selection),
  };
}

// Sau mỗi mutation clip: xóa track rỗng, nhưng giữ lại ít nhất 1 track
// mỗi kind (để không mất V1/A1/T1 mặc định).
function cleanupEmptyTracks(tracks) {
  const countByKind = {};
  tracks.forEach((t) => {
    countByKind[t.kind] = (countByKind[t.kind] || 0) + 1;
  });
  return tracks.filter((t) => {
    if (t.clips.length > 0) return true;
    // Empty: giữ nếu là track cuối cùng của kind đó
    if (countByKind[t.kind] === 1) return true;
    countByKind[t.kind]--;
    return false;
  });
}

function reducer(state, action) {
  switch (action.type) {
    case "commit": {
      return {
        ...state,
        __undo: [...state.__undo.slice(-(HISTORY_MAX - 1)), snapshot(state)],
        __redo: [],
      };
    }
    case "undo": {
      if (state.__undo.length === 0) return state;
      const prev = state.__undo[state.__undo.length - 1];
      return {
        ...state,
        tracks: prev.tracks,
        selection: prev.selection,
        __undo: state.__undo.slice(0, -1),
        __redo: [...state.__redo, snapshot(state)],
      };
    }
    case "redo": {
      if (state.__redo.length === 0) return state;
      const next = state.__redo[state.__redo.length - 1];
      return {
        ...state,
        tracks: next.tracks,
        selection: next.selection,
        __undo: [...state.__undo, snapshot(state)],
        __redo: state.__redo.slice(0, -1),
      };
    }
    case "setPlayhead":
      return { ...state, playhead: Math.max(0, action.t) };
    case "setZoom": {
      const pxPerSecond = Math.max(
        MIN_PX_PER_SEC,
        Math.min(MAX_PX_PER_SEC, action.px)
      );
      return { ...state, pxPerSecond };
    }
    case "setScrollX":
      return { ...state, scrollX: Math.max(0, action.x) };
    case "toggleSnap":
      return { ...state, snapEnabled: !state.snapEnabled };
    case "setTracks":
      return { ...state, tracks: action.tracks };
    case "setSelection":
      return { ...state, selection: new Set(action.ids) };
    case "clearSelection":
      return { ...state, selection: new Set() };
    case "toggleTrackMute":
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.trackId ? { ...t, muted: !t.muted } : t
        ),
      };
    case "toggleTrackLock":
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.trackId ? { ...t, locked: !t.locked } : t
        ),
      };
    case "toggleTrackHidden":
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.trackId ? { ...t, hidden: !t.hidden } : t
        ),
      };
    case "moveClips": {
      // Dịch các clip trong action.ids thêm deltaSec giây trên timeline.
      // Chặn không cho start < 0.
      const ids = new Set(action.ids);
      return {
        ...state,
        tracks: state.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            ids.has(c.id)
              ? { ...c, start: Math.max(0, c.start + action.deltaSec) }
              : c
          ),
        })),
      };
    }
    case "setClipStart": {
      return {
        ...state,
        tracks: state.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === action.clipId ? { ...c, start: Math.max(0, action.start) } : c
          ),
        })),
      };
    }
    case "setSnapGuide":
      return { ...state, snapGuide: action.time };
    case "resizeClip": {
      // Thay đổi start/duration/sourceStart cho 1 clip. Giữ bất biến
      // duration >= MIN_DURATION và start >= 0.
      const MIN = 0.1;
      return {
        ...state,
        tracks: state.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => {
            if (c.id !== action.clipId) return c;
            const next = { ...c, ...action.patch };
            if (next.duration < MIN) next.duration = MIN;
            if (next.start < 0) next.start = 0;
            return next;
          }),
        })),
      };
    }
    case "splitClip": {
      // Cắt clip đang chọn thành 2 tại action.atTime (giây timeline).
      return {
        ...state,
        tracks: state.tracks.map((t) => {
          const idx = t.clips.findIndex((c) => c.id === action.clipId);
          if (idx < 0) return t;
          const c = t.clips[idx];
          if (action.atTime <= c.start || action.atTime >= c.start + c.duration) {
            return t;
          }
          const leftDur = action.atTime - c.start;
          const rightDur = c.duration - leftDur;
          const rightSourceStart = (c.sourceStart || 0) + leftDur;
          const left = { ...c, duration: leftDur };
          const right = {
            ...c,
            id: c.id + "_" + Math.random().toString(36).slice(2, 7),
            start: action.atTime,
            duration: rightDur,
            sourceStart: rightSourceStart,
          };
          const next = [...t.clips];
          next.splice(idx, 1, left, right);
          return { ...t, clips: next };
        }),
      };
    }
    case "deleteClips": {
      const ids = new Set(action.ids);
      const next = state.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => !ids.has(c.id)),
      }));
      return {
        ...state,
        tracks: cleanupEmptyTracks(next),
        selection: new Set(),
      };
    }
    case "cleanupTracks":
      return { ...state, tracks: cleanupEmptyTracks(state.tracks) };
    case "moveClipToTrack": {
      // An toàn: nếu target không tồn tại hoặc clip đã ở target → no-op.
      // (Tránh clip bị "bốc hơi" khi caller giữ targetId stale.)
      const target = state.tracks.find((t) => t.id === action.targetTrackId);
      if (!target) return state;
      const source = state.tracks.find((t) =>
        t.clips.some((c) => c.id === action.clipId)
      );
      if (!source) return state;
      if (source.id === action.targetTrackId) return state;

      const clipObj = source.clips.find((c) => c.id === action.clipId);
      const moved = { ...clipObj, trackId: action.targetTrackId };

      const next = state.tracks.map((t) => {
        if (t.id === source.id) {
          return { ...t, clips: t.clips.filter((c) => c.id !== action.clipId) };
        }
        if (t.id === action.targetTrackId) {
          return { ...t, clips: [...t.clips, moved] };
        }
        return t;
      });
      // KHÔNG cleanup ở đây để track không biến mất giữa chừng drag.
      // Chỉ cleanup khi deleteClips hoặc ở mouseup commit.
      return { ...state, tracks: next };
    }
    case "addTrack": {
      // Chèn track mới cùng kind. position: "above" → trước cụm, "below" → sau cụm.
      const id = action.id || `${action.kind[0].toUpperCase()}${Date.now().toString(36).slice(-3)}`;
      const newTrack = {
        id,
        kind: action.kind,
        label: action.label || action.kind,
        height: action.height || (action.kind === "video" ? 60 : action.kind === "audio" ? 48 : 32),
        muted: false, locked: false, hidden: false,
        clips: [],
      };
      const sameKindIndices = state.tracks
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.kind === action.kind)
        .map(({ i }) => i);
      let insertAt;
      if (sameKindIndices.length === 0) {
        insertAt = state.tracks.length;
      } else if (action.position === "above") {
        insertAt = sameKindIndices[0];
      } else {
        insertAt = sameKindIndices[sameKindIndices.length - 1] + 1;
      }
      const next = [...state.tracks];
      next.splice(insertAt, 0, newTrack);
      return { ...state, tracks: next };
    }
    case "duplicateClips": {
      const ids = new Set(action.ids);
      const newIds = [];
      const next = state.tracks.map((t) => {
        const more = [];
        t.clips.forEach((c) => {
          if (ids.has(c.id)) {
            const newId = c.id + "_" + Math.random().toString(36).slice(2, 7);
            newIds.push(newId);
            more.push({ ...c, id: newId, start: c.start + c.duration });
          }
        });
        return { ...t, clips: [...t.clips, ...more] };
      });
      return { ...state, tracks: next, selection: new Set(newIds) };
    }
    default:
      return state;
  }
}

/**
 * Khởi tạo state từ project.
 * Tracks default: T1 (subtitle), V1 (video), A1 (dubbed), A2 (bg music).
 * Clip video = 1 clip bao full duration; subtitle clips sinh từ segments.
 */
export function buildInitialState(project) {
  const duration = project.video_duration || 0;
  const segments = project.segments || [];

  const tracks = [
    {
      id: "T1",
      kind: "subtitle",
      label: "Phụ đề",
      height: 32,
      muted: false,
      locked: false,
      hidden: false,
      clips: segments
        .filter((s) => s.translated_text?.trim())
        .map((s) => ({
          id: `sub_${s.id}`,
          segmentId: s.id,
          trackId: "T1",
          type: "subtitle",
          start: s.start,
          duration: Math.max(0.1, s.end - s.start),
          text: s.translated_text,
        })),
    },
    {
      id: "V1",
      kind: "video",
      label: "Video",
      height: 60,
      muted: false,
      locked: false,
      hidden: false,
      clips: [
        {
          id: "v_main",
          trackId: "V1",
          type: "video",
          start: 0,
          duration,
          sourceStart: 0,
        },
      ],
    },
    {
      id: "A1",
      kind: "audio",
      label: "Lồng tiếng",
      height: 48,
      muted: false,
      locked: false,
      hidden: false,
      clips:
        segments.length > 0
          ? [
              {
                id: "a_dub",
                trackId: "A1",
                type: "audio",
                start: 0,
                duration,
                sourceStart: 0,
              },
            ]
          : [],
    },
    {
      id: "A2",
      kind: "audio",
      label: "Nhạc nền",
      height: 48,
      muted: false,
      locked: false,
      hidden: false,
      clips: project.has_accompaniment
        ? [
            {
              id: "a_bg",
              trackId: "A2",
              type: "audio",
              start: 0,
              duration,
              sourceStart: 0,
            },
          ]
        : [],
    },
  ];

  return {
    tracks,
    selection: new Set(),
    playhead: 0,
    pxPerSecond: DEFAULT_PX_PER_SEC,
    scrollX: 0,
    snapEnabled: true,
    duration,
    snapGuide: null, // giây, hiển thị vạch vàng khi drag snap
    __undo: [],
    __redo: [],
  };
}

export function useTimelineState(project) {
  const initial = useMemo(() => buildInitialState(project), [project.id]);
  const [state, dispatch] = useReducer(reducer, initial);

  const actions = useMemo(
    () => ({
      setPlayhead: (t) => dispatch({ type: "setPlayhead", t }),
      setZoom: (px) => dispatch({ type: "setZoom", px }),
      setScrollX: (x) => dispatch({ type: "setScrollX", x }),
      toggleSnap: () => dispatch({ type: "toggleSnap" }),
      setTracks: (tracks) => dispatch({ type: "setTracks", tracks }),
      setSelection: (ids) => dispatch({ type: "setSelection", ids }),
      clearSelection: () => dispatch({ type: "clearSelection" }),
      toggleTrackMute: (trackId) =>
        dispatch({ type: "toggleTrackMute", trackId }),
      toggleTrackLock: (trackId) =>
        dispatch({ type: "toggleTrackLock", trackId }),
      toggleTrackHidden: (trackId) =>
        dispatch({ type: "toggleTrackHidden", trackId }),
      moveClips: (ids, deltaSec) =>
        dispatch({ type: "moveClips", ids, deltaSec }),
      setClipStart: (clipId, start) =>
        dispatch({ type: "setClipStart", clipId, start }),
      setSnapGuide: (time) =>
        dispatch({ type: "setSnapGuide", time }),
      resizeClip: (clipId, patch) =>
        dispatch({ type: "resizeClip", clipId, patch }),
      splitClip: (clipId, atTime) =>
        dispatch({ type: "splitClip", clipId, atTime }),
      deleteClips: (ids) => dispatch({ type: "deleteClips", ids }),
      duplicateClips: (ids) => dispatch({ type: "duplicateClips", ids }),
      moveClipToTrack: (clipId, targetTrackId) =>
        dispatch({ type: "moveClipToTrack", clipId, targetTrackId }),
      addTrack: (kind, opts = {}) => dispatch({ type: "addTrack", kind, ...opts }),
      cleanupTracks: () => dispatch({ type: "cleanupTracks" }),
      commit: () => dispatch({ type: "commit" }),
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" }),
    }),
    []
  );

  const timeToPx = useCallback(
    (t) => t * state.pxPerSecond,
    [state.pxPerSecond]
  );
  const pxToTime = useCallback(
    (px) => px / state.pxPerSecond,
    [state.pxPerSecond]
  );

  return { state, actions, timeToPx, pxToTime };
}

export const TIMELINE_CONSTANTS = {
  MIN_PX_PER_SEC,
  MAX_PX_PER_SEC,
  DEFAULT_PX_PER_SEC,
  HEADER_WIDTH: 120,
  RULER_HEIGHT: 24,
};
