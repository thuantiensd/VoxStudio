"""Face-based speaker detection — ground truth speaker mapping từ VIDEO.

Pyannote diarization audio-only thường merge speakers khi:
  • Utterance ngắn (<3s) không đủ audio đặc trưng
  • Voice gần giống (vd 2 nữ adult, hoặc cha-con cùng nam)
  • Nhạc nền ảnh hưởng F0

Face detection từ video giải quyết bằng GROUND TRUTH — frame nào face nào
mở miệng → speaker đó nói. Không phải đoán mò.

Pipeline:
  1. Sample frames từ video tại các speech segments (4-5 FPS đủ — lip
     movement detectable trong 200ms).
  2. mediapipe FaceMesh detect 468 landmarks/face per frame.
     → lip activity (MAR variance) per face track.
  3. Track faces qua frames bằng IoU bbox matching.
  4. Per-segment: face nào MAR variance cao nhất = speaker.
  5. Cluster face tracks → unique character IDs (face_id 0, 1, 2, ...).
  6. Gender per face: 2 layer cross-validate:
     • Layer A — insightface CNN (genderage_v1, ~95% accuracy, primary)
     • Layer B — geometry heuristic jaw/face ratio (fallback nếu insightface
       không có hoặc CNN trả unknown)

Public API:
  detect_speakers_by_face(video_path, segments, fps_sample=4)
    → FaceSpeakerResult{face_count, face_genders, segments_face, ...}

Yêu cầu:
  • mediapipe + opencv-python-headless (bắt buộc)
  • insightface + onnxruntime[-gpu] (optional — fallback heuristic nếu thiếu)
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


# ── Lip landmark indices (MediaPipe FaceMesh 468 model) ──
# Upper-lower lip vertical: dùng MAR (Mouth Aspect Ratio).
LIP_UPPER_INNER = 13
LIP_LOWER_INNER = 14
LIP_LEFT_CORNER = 78
LIP_RIGHT_CORNER = 308
# Jaw + face boundary cho gender heuristic
JAW_LEFT = 234
JAW_RIGHT = 454
FOREHEAD = 10
CHIN = 152


@dataclass
class FaceDetection:
    """1 face trong 1 frame."""
    bbox: tuple  # (x1, y1, x2, y2) normalized 0-1
    landmarks: np.ndarray  # (468, 2) normalized
    mar: float  # mouth aspect ratio
    confidence: float
    cnn_gender: Optional[str] = None  # "male"/"female"/None từ insightface
    geo_gender: Optional[str] = None  # "male"/"female"/"unknown" từ heuristic


@dataclass
class FaceTrack:
    """Track 1 character qua nhiều frames."""
    track_id: int
    detections: list = field(default_factory=list)  # [(frame_t, FaceDetection)]
    gender_hint: str = "unknown"  # male/female/unknown
    avg_bbox_size: float = 0.0


@dataclass
class FaceSpeakerResult:
    """Kết quả analyze."""
    face_count: int
    face_genders: dict[int, str]
    face_gender_confs: dict[int, float]  # CNN+geo cross-validate confidence
    segments_face: dict[int, Optional[int]]  # seg_index → face_id (None nếu không detect)
    segments_confidence: dict[int, float]
    stats: dict


def _check_available() -> bool:
    try:
        import mediapipe  # noqa: F401
        import cv2  # noqa: F401
        return True
    except ImportError as e:
        logger.warning("face_speaker_svc unavailable: %s", e)
        return False


# ── InsightFace CNN gender (optional, fallback geometry) ──
_INSIGHTFACE_APP = None
_INSIGHTFACE_TRIED = False


def _get_insightface_app():
    """Lazy-load insightface FaceAnalysis với gender+age model.

    Cache model trong /workspace/insightface_cache (persistent volume).
    Trả None nếu insightface không cài hoặc load fail.
    """
    global _INSIGHTFACE_APP, _INSIGHTFACE_TRIED
    if _INSIGHTFACE_TRIED:
        return _INSIGHTFACE_APP
    _INSIGHTFACE_TRIED = True
    try:
        import os as _os
        from insightface.app import FaceAnalysis  # type: ignore

        # Cache trong /workspace để persistent qua pod restart
        cache_root = _os.environ.get(
            "INSIGHTFACE_HOME",
            "/workspace/insightface_cache" if _os.path.isdir("/workspace") else None,
        )
        kwargs = {
            "name": "buffalo_l",  # bao gồm detection + landmark + genderage
            "allowed_modules": ["detection", "genderage"],
        }
        if cache_root:
            _os.makedirs(cache_root, exist_ok=True)
            kwargs["root"] = cache_root

        app = FaceAnalysis(**kwargs)
        # ctx_id=0 → GPU0; -1 → CPU. Auto pick.
        import torch as _torch
        ctx_id = 0 if _torch.cuda.is_available() else -1
        app.prepare(ctx_id=ctx_id, det_size=(320, 320))
        _INSIGHTFACE_APP = app
        logger.info("insightface FaceAnalysis loaded (ctx_id=%d, root=%s)",
                     ctx_id, cache_root or "default")
        return app
    except ImportError:
        logger.info("insightface chưa cài — fallback geometry gender heuristic. "
                     "pip install insightface onnxruntime-gpu để bật CNN gender.")
        return None
    except Exception as e:
        logger.warning("insightface load failed: %s — fallback heuristic", e)
        return None


def _gender_via_insightface(frame_bgr, bbox: tuple) -> Optional[str]:
    """Predict gender bằng CNN insightface trên crop face từ frame.

    bbox: (x1, y1, x2, y2) normalized 0-1.
    Trả "male" / "female" / None.
    """
    app = _get_insightface_app()
    if app is None:
        return None
    try:
        h, w = frame_bgr.shape[:2]
        x1, y1, x2, y2 = bbox
        # Mở rộng bbox 15% mỗi cạnh cho insightface (cần context xung quanh face)
        bw = x2 - x1
        bh = y2 - y1
        x1 = max(0.0, x1 - bw * 0.15)
        y1 = max(0.0, y1 - bh * 0.15)
        x2 = min(1.0, x2 + bw * 0.15)
        y2 = min(1.0, y2 + bh * 0.15)
        px1, py1 = int(x1 * w), int(y1 * h)
        px2, py2 = int(x2 * w), int(y2 * h)
        if px2 <= px1 or py2 <= py1:
            return None
        crop = frame_bgr[py1:py2, px1:px2]
        if crop.size == 0:
            return None
        faces = app.get(crop)
        if not faces:
            return None
        # Pick face lớn nhất trong crop (nhân vật chính)
        face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        # insightface: gender 0=female, 1=male
        return "male" if int(face.gender) == 1 else "female"
    except Exception as e:
        logger.debug("insightface predict fail: %s", e)
        return None


def _bbox_from_landmarks(landmarks: np.ndarray) -> tuple:
    """Compute bounding box từ 468 landmarks. Normalized 0-1."""
    xs = landmarks[:, 0]
    ys = landmarks[:, 1]
    return (float(xs.min()), float(ys.min()),
            float(xs.max()), float(ys.max()))


def _bbox_iou(a: tuple, b: tuple) -> float:
    """IoU 2 bbox normalized."""
    x1, y1, x2, y2 = a
    X1, Y1, X2, Y2 = b
    ix1, iy1 = max(x1, X1), max(y1, Y1)
    ix2, iy2 = min(x2, X2), min(y2, Y2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    area_a = (x2 - x1) * (y2 - y1)
    area_b = (X2 - X1) * (Y2 - Y1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _mar(landmarks: np.ndarray) -> float:
    """Mouth Aspect Ratio — ratio chiều cao môi / chiều rộng môi.

    Cao + biến thiên = đang nói. Thấp ổn định = đang câm/listen.
    """
    upper = landmarks[LIP_UPPER_INNER]
    lower = landmarks[LIP_LOWER_INNER]
    left = landmarks[LIP_LEFT_CORNER]
    right = landmarks[LIP_RIGHT_CORNER]
    h = abs(upper[1] - lower[1])
    w = abs(left[0] - right[0])
    return float(h / w) if w > 0.001 else 0.0


def _gender_from_landmarks(landmarks: np.ndarray) -> str:
    """Gender heuristic từ face geometry.

    Nam thường có:
      • Jaw rộng hơn (jaw_width / face_height ratio cao)
      • Khuôn mặt vuông hơn
    Nữ thường có:
      • Jaw hẹp hơn, mặt oval

    Heuristic ratio threshold:
      ratio > 0.78 → male
      ratio < 0.72 → female
      between → unknown (caller fallback audio gender)

    Không dùng CNN — geometry đơn giản đủ cho 70-80% case. Audio gender
    + LLM Pass-0 evidence cross-validate phần còn lại.
    """
    jaw_w = abs(landmarks[JAW_RIGHT][0] - landmarks[JAW_LEFT][0])
    face_h = abs(landmarks[CHIN][1] - landmarks[FOREHEAD][1])
    if face_h < 0.01:
        return "unknown"
    ratio = jaw_w / face_h
    if ratio > 0.78:
        return "male"
    if ratio < 0.72:
        return "female"
    return "unknown"


def _sample_timestamps(start: float, end: float, fps: float) -> list[float]:
    """Trả về list timestamps để sample frame trong [start, end] @ fps."""
    duration = end - start
    if duration <= 0:
        return []
    n = max(1, int(duration * fps))
    step = duration / n
    return [start + i * step + step / 2 for i in range(n)]


def detect_speakers_by_face(
    video_path: str,
    segments: list[dict],
    fps_sample: float = 4.0,
    max_faces: int = 6,
) -> Optional[FaceSpeakerResult]:
    """Analyze video → per-segment face_id assignment.

    Args:
      video_path: path tới video file (mp4/mov/mkv).
      segments: list[{index, start, end, ...}] — speech segments từ Whisper.
      fps_sample: frames/giây sample trong mỗi segment (default 4 = 1 frame/250ms).
      max_faces: tối đa số face track tracking (drama thường 2-4).

    Returns FaceSpeakerResult hoặc None nếu mediapipe/opencv không có
    hoặc video không đọc được.
    """
    if not _check_available():
        return None
    video_p = Path(video_path)
    if not video_p.exists():
        logger.warning("face_speaker: video không tồn tại: %s", video_path)
        return None

    import cv2
    import mediapipe as mp

    t_start = time.time()

    cap = cv2.VideoCapture(str(video_p))
    if not cap.isOpened():
        logger.warning("face_speaker: không mở được video %s", video_path)
        return None
    video_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0

    mp_face_mesh = mp.solutions.face_mesh
    face_mesh = mp_face_mesh.FaceMesh(
        static_image_mode=False,
        max_num_faces=max_faces,
        refine_landmarks=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    # Track faces toàn pipeline — IoU matching, simple.
    tracks: list[FaceTrack] = []
    next_track_id = 0
    IOU_MATCH_THRESHOLD = 0.30

    def _match_or_create_track(det: FaceDetection, frame_t: float) -> int:
        nonlocal next_track_id
        # Tìm track gần đây nhất (within 2s) có IoU cao nhất
        best_id, best_iou = -1, 0.0
        for tr in tracks:
            if not tr.detections:
                continue
            last_t, last_det = tr.detections[-1]
            if frame_t - last_t > 2.0:
                continue  # track quá cũ, không match
            iou = _bbox_iou(det.bbox, last_det.bbox)
            if iou > best_iou:
                best_iou = iou
                best_id = tr.track_id
        if best_iou >= IOU_MATCH_THRESHOLD:
            return best_id
        # Tạo track mới
        new_track = FaceTrack(track_id=next_track_id)
        tracks.append(new_track)
        next_track_id += 1
        return new_track.track_id

    # Map track_id → list detections (frame_t, FaceDetection)
    segments_face: dict[int, Optional[int]] = {}
    segments_confidence: dict[int, float] = {}

    n_segments = len(segments)
    if n_segments == 0:
        cap.release()
        face_mesh.close()
        return None

    # Sample + detect + assign per-segment.
    for seg in segments:
        seg_idx = seg.get("index")
        if seg_idx is None:
            continue
        seg_start = float(seg.get("start") or 0)
        seg_end = float(seg.get("end") or 0)
        ts_samples = _sample_timestamps(seg_start, seg_end, fps_sample)
        if not ts_samples:
            segments_face[seg_idx] = None
            segments_confidence[seg_idx] = 0.0
            continue

        # Detect faces trong các sample frames của segment này
        face_mar_per_track: dict[int, list[float]] = {}
        for ts in ts_samples:
            frame_idx = int(ts * video_fps)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            # mediapipe expect RGB
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = face_mesh.process(rgb)
            if not results.multi_face_landmarks:
                continue
            # H, W = frame.shape[:2]  # landmarks đã normalized
            for face_lm in results.multi_face_landmarks:
                lm_arr = np.array(
                    [[p.x, p.y] for p in face_lm.landmark],
                    dtype=np.float32,
                )
                bbox = _bbox_from_landmarks(lm_arr)
                mar_val = _mar(lm_arr)
                # Gender — 2 layer:
                # • CNN insightface (chính xác hơn) — chỉ chạy với 1 vài frame
                #   đầu mỗi track để tiết kiệm thời gian (~10ms/face).
                # • Geometry heuristic luôn chạy làm fallback.
                geo_g = _gender_from_landmarks(lm_arr)
                cnn_g = None
                # Heuristic: chỉ CNN-detect nếu track chưa có sample gender chắc
                # chắn — tracks lâu sẽ thử nhiều frame để vote.
                # Tránh overhead chạy CNN trên MỌI face/frame.
                # Logic: chạy CNN 3 frames đầu mỗi track + thêm 2 frame sau.
                # Decision tại assign track step (sau loop chính).
                det = FaceDetection(
                    bbox=bbox, landmarks=lm_arr,
                    mar=mar_val, confidence=1.0,
                    cnn_gender=None, geo_gender=geo_g,
                )
                tid = _match_or_create_track(det, ts)
                # Append detection vào track
                for tr in tracks:
                    if tr.track_id == tid:
                        # Chạy CNN gender cho 5 frame đầu mỗi track (đủ vote tốt)
                        if len(tr.detections) < 5:
                            cnn_g = _gender_via_insightface(frame, bbox)
                            det.cnn_gender = cnn_g
                        tr.detections.append((ts, det))
                        break
                face_mar_per_track.setdefault(tid, []).append(mar_val)

        # Assign segment → face_id có MAR variance cao nhất (= đang nói).
        # Tie-break: face có nhiều sample nhất.
        if not face_mar_per_track:
            segments_face[seg_idx] = None
            segments_confidence[seg_idx] = 0.0
            continue

        best_tid = None
        best_var = -1.0
        for tid, mars in face_mar_per_track.items():
            if len(mars) < 2:
                v = sum(mars) / len(mars)  # 1 sample: dùng giá trị tuyệt đối
            else:
                v = float(np.var(mars)) + sum(mars) / len(mars) * 0.1
            if v > best_var:
                best_var = v
                best_tid = tid

        segments_face[seg_idx] = best_tid
        # Confidence dựa trên: variance cao + n_samples đủ + chỉ 1 face (không tie)
        n_face_tracks = len(face_mar_per_track)
        n_samples = len(face_mar_per_track.get(best_tid, []))
        if n_face_tracks == 1:
            conf = min(1.0, 0.7 + 0.05 * n_samples)
        else:
            # Multiple faces — confidence từ variance dominance
            sorted_vars = sorted(face_mar_per_track.values(),
                                  key=lambda lst: np.var(lst) if len(lst) > 1 else 0.0,
                                  reverse=True)
            top_var = (np.var(sorted_vars[0]) if len(sorted_vars[0]) > 1 else 0.0)
            second_var = (np.var(sorted_vars[1]) if len(sorted_vars) > 1 and len(sorted_vars[1]) > 1 else 0.001)
            ratio = top_var / max(second_var, 0.001)
            conf = min(0.95, 0.4 + 0.15 * min(4, ratio))
        segments_confidence[seg_idx] = float(conf)

    cap.release()
    face_mesh.close()

    # Compute gender per face track — cross-validate CNN insightface + geometry.
    # CNN có trọng số CAO HƠN (3x) vì accuracy 95% vs heuristic 70-80%.
    face_genders: dict[int, str] = {}
    face_gender_confs: dict[int, float] = {}
    for tr in tracks:
        if not tr.detections:
            continue
        cnn_votes: list[str] = []  # weight 3
        geo_votes: list[str] = []  # weight 1
        for _, det in tr.detections[:30]:
            if det.cnn_gender in ("male", "female"):
                cnn_votes.append(det.cnn_gender)
            if det.geo_gender in ("male", "female"):
                geo_votes.append(det.geo_gender)

        male_score = cnn_votes.count("male") * 3 + geo_votes.count("male")
        female_score = cnn_votes.count("female") * 3 + geo_votes.count("female")
        total = male_score + female_score

        if total == 0:
            face_genders[tr.track_id] = "unknown"
            face_gender_confs[tr.track_id] = 0.0
            continue

        if male_score > female_score * 1.3:
            face_genders[tr.track_id] = "male"
        elif female_score > male_score * 1.3:
            face_genders[tr.track_id] = "female"
        else:
            face_genders[tr.track_id] = "unknown"
        # Confidence = dominant / total (0.5-1.0)
        dom = max(male_score, female_score)
        face_gender_confs[tr.track_id] = round(dom / total, 2)

    # Filter: chỉ giữ track có >=2 detections (loại noise/false positive)
    active_tracks = [tr for tr in tracks if len(tr.detections) >= 2]
    active_ids = {tr.track_id for tr in active_tracks}
    # Clean segments_face: nếu face_id không trong active → None
    for seg_idx in list(segments_face.keys()):
        if segments_face[seg_idx] is not None and segments_face[seg_idx] not in active_ids:
            segments_face[seg_idx] = None
            segments_confidence[seg_idx] = 0.0

    elapsed = time.time() - t_start

    # Stats cho debug
    n_assigned = sum(1 for v in segments_face.values() if v is not None)
    stats = {
        "elapsed_sec": round(elapsed, 2),
        "total_segments": n_segments,
        "segments_with_face": n_assigned,
        "coverage_pct": round(100 * n_assigned / max(1, n_segments), 1),
        "n_face_tracks_total": len(tracks),
        "n_face_tracks_active": len(active_tracks),
        "video_fps": video_fps,
        "fps_sample": fps_sample,
    }

    # Log gender summary
    gender_summary = ", ".join(
        f"FACE_{tid:02d}={face_genders.get(tid, '?')}({face_gender_confs.get(tid, 0):.2f})"
        for tid in sorted(t.track_id for t in active_tracks)
    )
    insightface_used = _get_insightface_app() is not None
    logger.info(
        "face_speaker: %d/%d segments có face (%.1f%%) · %d face active · "
        "%.1fs · gender_engine=%s · [%s]",
        n_assigned, n_segments,
        stats["coverage_pct"], len(active_tracks), elapsed,
        "CNN+heuristic" if insightface_used else "heuristic_only",
        gender_summary,
    )

    return FaceSpeakerResult(
        face_count=len(active_tracks),
        face_genders=face_genders,
        face_gender_confs=face_gender_confs,
        segments_face=segments_face,
        segments_confidence=segments_confidence,
        stats={**stats, "insightface_used": insightface_used,
               "face_gender_confs": face_gender_confs},
    )


def apply_face_speakers_to_segments(
    segments: list[dict],
    result: FaceSpeakerResult,
    min_confidence: float = 0.6,
    min_gender_confidence: float = 0.65,
    override_audio: bool = True,
) -> int:
    """Apply face_id từ FaceSpeakerResult vào segments[i]['speaker'] in-place.

    Args:
      segments: list segment (mutated in-place).
      result: FaceSpeakerResult từ detect_speakers_by_face().
      min_confidence: threshold confidence để override speaker_id cũ.
      min_gender_confidence: threshold riêng cho override gender (audio gender
        từ F0 vẫn được giữ nếu face gender confidence thấp).
      override_audio: True → ghi đè 'speaker' từ pyannote (default).
                       False → chỉ thêm 'face_id' field, giữ 'speaker' nguyên.

    Returns: số segment đã update.
    """
    if not result:
        return 0
    updated = 0
    for seg in segments:
        idx = seg.get("index")
        if idx is None:
            continue
        face_id = result.segments_face.get(idx)
        conf = result.segments_confidence.get(idx, 0.0)
        if face_id is None or conf < min_confidence:
            continue
        # Convert int face_id → string "FACE_XX" để consistent với SPEAKER_XX
        face_speaker_id = f"FACE_{face_id:02d}"
        seg["face_id"] = face_speaker_id
        seg["face_confidence"] = round(conf, 2)
        if override_audio:
            seg["speaker"] = face_speaker_id
            face_g = result.face_genders.get(face_id)
            face_g_conf = result.face_gender_confs.get(face_id, 0.0)
            # CHỈ override gender khi CNN+geo vote cao. Nếu thấp, giữ
            # gender từ audio (F0) để cross-validate sau với LLM Pass-0.
            if face_g and face_g != "unknown" and face_g_conf >= min_gender_confidence:
                seg["speaker_gender"] = face_g
        updated += 1
    return updated
