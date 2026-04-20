import { useState, useRef, useEffect } from "react";
import { Play, Pause, Maximize2 } from "lucide-react";
import { dubbingVideoURL } from "../../services/api";
import SubtitleOverlay from "../dubbing/SubtitleOverlay";

function fmtTime(s) {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * VideoPreview — player dùng chung cho cả tab Lồng tiếng và Nâng cao.
 * Overlay phụ đề live dựa trên segments + subtitle_style hiện tại.
 */
export default function VideoPreview({
  project, subtitleStyle, showSubtitles,
  previewSubtitle, onSubtitleCommit,
}) {
  const videoRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(project.video_duration || 0);
  const [aspect, setAspect] = useState(16 / 9);
  const [videoWidth, setVideoWidth] = useState(1920);
  const [videoHeight, setVideoHeight] = useState(1080);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onLoaded = () => {
      setDuration(v.duration);
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        setAspect(v.videoWidth / v.videoHeight);
        setVideoWidth(v.videoWidth);
        setVideoHeight(v.videoHeight);
      }
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("loadedmetadata", onLoaded);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("loadedmetadata", onLoaded);
    };
  }, [project.id]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const seek = (t) => {
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  const segments = project.segments || [];

  return (
    <div
      className="relative flex items-center justify-center w-full h-full"
      style={{ background: "#000" }}
    >
      {/* Video + overlay — wrapper set aspect ratio đúng video gốc */}
      <div className="relative flex items-center justify-center"
           style={{ width: "100%", height: "calc(100% - 44px)" }}>
        <div
          className="relative rounded overflow-hidden"
          style={{
            aspectRatio: aspect,
            maxWidth: "100%",
            maxHeight: "100%",
            // dùng min để ưu tiên fit theo cạnh nhỏ hơn của container
            width: aspect >= 1 ? "100%" : "auto",
            height: aspect >= 1 ? "auto" : "100%",
          }}
        >
          <video
            ref={videoRef}
            src={dubbingVideoURL(project.id)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
            }}
            onClick={togglePlay}
            onDoubleClick={() => videoRef.current?.requestFullscreen?.()}
          />
          {showSubtitles && (
            <SubtitleOverlay
              segments={segments}
              currentTime={currentTime}
              style={subtitleStyle}
              placeholder={previewSubtitle}
              onCommit={onSubtitleCommit}
              videoWidth={videoWidth}
              videoHeight={videoHeight}
            />
          )}
          {/* Play overlay khi pause — căn giữa video, không phải container */}
          {!isPlaying && (
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{ zIndex: 5 }}
            >
              <div
                className="rounded-full flex items-center justify-center"
                style={{
                  width: 56,
                  height: 56,
                  background: "rgba(0,0,0,0.55)",
                  backdropFilter: "blur(4px)",
                }}
              >
                <Play size={22} color="#fff" style={{ marginLeft: 3 }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Controls bar — bám đáy container full width */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-3 py-2"
        style={{
          zIndex: 10,
          background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
        }}
      >
        <button
          onClick={togglePlay}
          className="p-1 rounded hover:bg-white/10"
          style={{ color: "#fff" }}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 60}
          step={0.1}
          value={currentTime}
          onChange={(e) => seek(parseFloat(e.target.value))}
          className="flex-1"
          style={{ accentColor: "var(--accent)", height: 4 }}
        />
        <span
          className="text-xs font-mono flex-shrink-0"
          style={{ color: "#ccc", fontSize: 10, whiteSpace: "nowrap" }}
        >
          {fmtTime(currentTime)} / {fmtTime(duration)}
        </span>
        <button
          onClick={() => videoRef.current?.requestFullscreen?.()}
          className="p-1 rounded hover:bg-white/10"
          style={{ color: "#aaa" }}
        >
          <Maximize2 size={12} />
        </button>
      </div>
    </div>
  );
}
