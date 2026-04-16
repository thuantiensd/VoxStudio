import { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, Download, Scissors, X } from 'lucide-react';

const BAR_GAP = 1.2;

function fmt(s) {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 10);
  return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `0:${sec.toString().padStart(2, '0')}.${ms}`;
}

export default function AudioPlayer({ src, filename = 'audio.wav', compact = false, onTrim = null }) {
  const audioRef = useRef(null);
  const waveRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveform, setWaveform] = useState(null);

  // Trim state
  const [trimMode, setTrimMode] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragType = useRef(null); // 'start' | 'end' | 'region' | 'select' | null
  const dragOrigin = useRef(0);
  const trimSnap = useRef({ start: 0, end: 1 });

  const barCount = compact ? 60 : 90;
  const barHeight = compact ? 28 : 40;

  // Decode waveform
  useEffect(() => {
    if (!src) return;
    setPlaying(false);
    setProgress(0);
    setWaveform(null);
    setTrimMode(false);
    setTrimStart(0);
    setTrimEnd(1);

    let cancelled = false;
    const ctx = new AudioContext();
    fetch(src)
      .then(r => r.arrayBuffer())
      .then(buf => ctx.decodeAudioData(buf))
      .then(decoded => {
        if (cancelled) return;
        const raw = decoded.getChannelData(0);
        const bars = [];
        const step = Math.floor(raw.length / barCount);
        for (let i = 0; i < barCount; i++) {
          let sum = 0;
          const offset = i * step;
          for (let j = 0; j < step; j++) sum += Math.abs(raw[offset + j] || 0);
          bars.push(sum / step);
        }
        const peak = Math.max(...bars, 0.001);
        setWaveform(bars.map(v => Math.max(0.06, v / peak)));
      })
      .catch(() => {
        if (!cancelled) {
          setWaveform(Array.from({ length: barCount }, (_, i) =>
            0.15 + 0.5 * Math.sin(i * 0.3) ** 2 + Math.random() * 0.15
          ));
        }
      });

    return () => { cancelled = true; ctx.close(); };
  }, [src, barCount]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
    } else {
      if (trimMode) {
        const startT = trimStart * duration;
        if (a.currentTime < startT || a.currentTime >= trimEnd * duration) {
          a.currentTime = startT;
        }
      }
      a.play();
    }
    setPlaying(!playing);
  };

  // Pause at trim end
  useEffect(() => {
    if (!playing || !trimMode || !duration) return;
    if (progress >= trimEnd * duration - 0.05) {
      audioRef.current?.pause();
      setPlaying(false);
    }
  }, [progress, playing, trimMode, trimEnd, duration]);

  const getFrac = useCallback((e) => {
    const rect = waveRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (!duration) return;
    e.preventDefault();
    const frac = getFrac(e);
    let moved = false;

    if (trimMode) {
      // Check if near handles (within 3% of width)
      const threshold = 0.03;
      if (Math.abs(frac - trimStart) < threshold) {
        dragType.current = 'start';
      } else if (Math.abs(frac - trimEnd) < threshold) {
        dragType.current = 'end';
      } else if (frac > trimStart && frac < trimEnd) {
        // Inside region — will decide on mouseup if it's a click (seek) or drag (move region)
        dragType.current = 'maybe-region';
        dragOrigin.current = frac;
        trimSnap.current = { start: trimStart, end: trimEnd };
      } else {
        // Outside = new selection by dragging
        dragType.current = 'select';
        dragOrigin.current = frac;
        setTrimStart(frac);
        setTrimEnd(frac);
      }
    } else {
      // Normal seek
      dragType.current = 'seek';
      if (audioRef.current) audioRef.current.currentTime = frac * duration;
    }

    setIsDragging(true);

    const onMove = (ev) => {
      ev.preventDefault();
      const f = getFrac(ev);
      // Detect if actually moved (for differentiating click vs drag)
      if (!moved && Math.abs(f - frac) > 0.01) {
        moved = true;
        // Upgrade maybe-region to region drag
        if (dragType.current === 'maybe-region') {
          dragType.current = 'region';
        }
      }
      switch (dragType.current) {
        case 'start':
          setTrimStart(Math.max(0, Math.min(f, trimEnd - 0.01)));
          break;
        case 'end':
          setTrimEnd(Math.min(1, Math.max(f, trimStart + 0.01)));
          break;
        case 'region': {
          const delta = f - dragOrigin.current;
          let ns = trimSnap.current.start + delta;
          let ne = trimSnap.current.end + delta;
          const w = ne - ns;
          if (ns < 0) { ns = 0; ne = w; }
          if (ne > 1) { ne = 1; ns = 1 - w; }
          setTrimStart(ns);
          setTrimEnd(ne);
          break;
        }
        case 'select': {
          const origin = dragOrigin.current;
          setTrimStart(Math.min(origin, f));
          setTrimEnd(Math.max(origin, f));
          break;
        }
        case 'seek':
          if (audioRef.current) audioRef.current.currentTime = f * duration;
          break;
      }
    };

    const onUp = () => {
      // If clicked inside region without dragging → seek to that position for preview
      if (dragType.current === 'maybe-region' && !moved) {
        if (audioRef.current) audioRef.current.currentTime = frac * duration;
      }
      dragType.current = null;
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, [duration, trimMode, trimStart, trimEnd, getFrac]);

  const enterTrim = () => {
    setTrimMode(true);
    setTrimStart(0);
    setTrimEnd(1);
  };

  const exitTrim = () => {
    setTrimMode(false);
    setTrimStart(0);
    setTrimEnd(1);
  };

  const [trimming, setTrimming] = useState(false);

  // Apply trim — either replace audio (onTrim) or download
  const applyTrim = async () => {
    if (!src || !duration) return;
    setTrimming(true);
    try {
      const audioCtx = new AudioContext();
      const resp = await fetch(src);
      const buf = await resp.arrayBuffer();
      const decoded = await audioCtx.decodeAudioData(buf);

      const s = Math.floor(trimStart * decoded.length);
      const e = Math.floor(trimEnd * decoded.length);
      const len = e - s;

      const trimBuf = audioCtx.createBuffer(decoded.numberOfChannels, len, decoded.sampleRate);
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        const srcData = decoded.getChannelData(ch);
        const dst = trimBuf.getChannelData(ch);
        for (let i = 0; i < len; i++) dst[i] = srcData[s + i];
      }

      const wav = encodeWAV(trimBuf);
      const blob = new Blob([wav], { type: 'audio/wav' });

      if (onTrim) {
        // Replace current audio
        const file = new File([blob], filename.replace(/\.[^.]+$/, '.wav'), { type: 'audio/wav' });
        onTrim(file, URL.createObjectURL(blob));
      } else {
        // Download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.replace(/\.[^.]+$/, '_cut.wav');
        a.click();
        URL.revokeObjectURL(url);
      }
      audioCtx.close();
      exitTrim();
    } catch (err) {
      console.error('Trim failed:', err);
    }
    setTrimming(false);
  };

  if (!src) return null;

  const progressFrac = duration ? progress / duration : 0;
  const hasTrimSelection = trimMode && Math.abs(trimEnd - trimStart) > 0.01;
  const trimDuration = (trimEnd - trimStart) * duration;

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.04)' }}>
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => setProgress(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => setPlaying(false)}
      />

      <div className={compact ? 'px-3 pt-2.5 pb-2' : 'px-4 pt-3 pb-2.5'}>
        {/* Waveform */}
        <div className="flex items-center gap-2.5">
          {/* Play */}
          <button onClick={toggle}
            className={`${compact ? 'w-8 h-8' : 'w-10 h-10'} rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-90`}
            style={{
              background: 'linear-gradient(135deg, var(--accent), #8b5cf6)',
              boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
            }}>
            {playing
              ? <Pause size={compact ? 12 : 14} fill="#fff" color="#fff" />
              : <Play size={compact ? 12 : 14} fill="#fff" color="#fff" className="ml-0.5" />
            }
          </button>

          {/* Waveform area */}
          <div className="flex-1 min-w-0">
            <div
              ref={waveRef}
              className="relative"
              style={{
                height: barHeight,
                cursor: trimMode ? (isDragging ? 'grabbing' : 'crosshair') : 'pointer',
                touchAction: 'none',
              }}
              onMouseDown={handlePointerDown}
              onTouchStart={handlePointerDown}
            >
              {/* Trim overlay */}
              {trimMode && (
                <>
                  {/* Dim outside */}
                  <div className="absolute inset-y-0 left-0 rounded-l"
                    style={{ width: `${trimStart * 100}%`, background: 'rgba(0,0,0,0.45)', zIndex: 2, pointerEvents: 'none' }} />
                  <div className="absolute inset-y-0 right-0 rounded-r"
                    style={{ width: `${(1 - trimEnd) * 100}%`, background: 'rgba(0,0,0,0.45)', zIndex: 2, pointerEvents: 'none' }} />
                  {/* Selected region border */}
                  <div className="absolute inset-y-0" style={{
                    left: `${trimStart * 100}%`,
                    width: `${(trimEnd - trimStart) * 100}%`,
                    border: '1.5px solid #22c55e',
                    borderRadius: 3,
                    zIndex: 2,
                    pointerEvents: 'none',
                  }} />
                  {/* Left handle */}
                  <div className="absolute flex items-center justify-center"
                    style={{
                      left: `${trimStart * 100}%`, top: 0, bottom: 0, width: 10, transform: 'translateX(-5px)',
                      zIndex: 5, cursor: 'ew-resize',
                    }}>
                    <div style={{ width: 3, height: '60%', background: '#22c55e', borderRadius: 2 }} />
                  </div>
                  {/* Right handle */}
                  <div className="absolute flex items-center justify-center"
                    style={{
                      left: `${trimEnd * 100}%`, top: 0, bottom: 0, width: 10, transform: 'translateX(-5px)',
                      zIndex: 5, cursor: 'ew-resize',
                    }}>
                    <div style={{ width: 3, height: '60%', background: '#22c55e', borderRadius: 2 }} />
                  </div>
                </>
              )}

              {/* Bars */}
              <div className="flex items-center h-full" style={{ gap: BAR_GAP }}>
                {(waveform || Array.from({ length: barCount }, () => 0.1)).map((v, i) => {
                  const f = (i + 0.5) / barCount;
                  const played = f <= progressFrac;
                  const inTrim = !trimMode || (f >= trimStart && f <= trimEnd);

                  let bg;
                  if (!trimMode) {
                    bg = played ? 'var(--accent)' : 'rgba(255,255,255,0.08)';
                  } else if (inTrim && played) {
                    bg = '#22c55e';
                  } else if (inTrim) {
                    bg = 'rgba(34,197,94,0.25)';
                  } else if (played) {
                    bg = 'rgba(255,255,255,0.12)';
                  } else {
                    bg = 'rgba(255,255,255,0.04)';
                  }

                  const h = `${Math.max(10, v * 100)}%`;
                  return (
                    <div key={i} className="flex-1 rounded-full"
                      style={{ height: h, minHeight: 3, background: bg, transition: isDragging ? 'none' : 'background 0.15s' }} />
                  );
                })}
              </div>

              {/* Playhead */}
              <div className="absolute top-0 bottom-0 pointer-events-none" style={{
                left: `${progressFrac * 100}%`,
                width: 1.5,
                background: trimMode ? '#22c55e' : '#fff',
                zIndex: 4,
                opacity: 0.9,
                borderRadius: 1,
              }} />
            </div>

            {/* Time bar */}
            <div className={`flex items-center justify-between ${compact ? 'mt-0.5' : 'mt-1'}`}>
              <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)', fontSize: compact ? 10 : 11 }}>
                {fmt(progress)}
              </span>
              {trimMode && hasTrimSelection && (
                <span className="text-xs font-mono px-1.5 py-0.5 rounded"
                  style={{ color: '#22c55e', fontSize: 10, background: 'rgba(34,197,94,0.1)' }}>
                  {fmt(trimStart * duration)} → {fmt(trimEnd * duration)} ({fmt(trimDuration)})
                </span>
              )}
              <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)', fontSize: compact ? 10 : 11 }}>
                {fmt(duration)}
              </span>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className={`flex items-center justify-end gap-1 ${compact ? 'mt-1' : 'mt-1.5'}`}>
          {trimMode ? (
            <>
              {hasTrimSelection && (
                <button onClick={applyTrim} disabled={trimming}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all hover:brightness-110 disabled:opacity-50"
                  style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                  {onTrim ? <Scissors size={12} /> : <Download size={12} />}
                  {trimming ? 'Đang cắt...' : onTrim ? 'Cắt' : 'Tải đoạn cắt'}
                </button>
              )}
              <button onClick={exitTrim}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors hover:opacity-80"
                style={{ color: 'var(--text-secondary)' }}>
                <X size={12} /> Huỷ
              </button>
            </>
          ) : (
            <>
              <button onClick={enterTrim}
                className="p-1.5 rounded-md transition-colors hover:opacity-80"
                title="Cắt audio"
                style={{ color: 'var(--text-secondary)' }}>
                <Scissors size={compact ? 13 : 14} />
              </button>
              <a href={src} download={filename}
                className="p-1.5 rounded-md hover:opacity-80"
                title="Tải xuống"
                style={{ color: 'var(--text-secondary)' }}>
                <Download size={compact ? 13 : 14} />
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function encodeWAV(buf) {
  const ch = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const len = buf.length;
  const bps = 16;
  const dataSize = len * ch * 2;
  const ab = new ArrayBuffer(44 + dataSize);
  const v = new DataView(ab);

  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true);
  ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true);
  v.setUint16(34, bps, true); ws(36, 'data'); v.setUint32(40, dataSize, true);

  let off = 44;
  const chs = [];
  for (let c = 0; c < ch; c++) chs.push(buf.getChannelData(c));
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chs[c][i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return ab;
}
