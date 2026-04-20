import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * SubtitleOverlay — WYSIWYG render phụ đề trên video preview.
 *
 * NGUYÊN LÝ: Single source of truth là `style` (subtitle_style). Mọi thao
 * tác (drag / scale / rotate / resize width) KHÔNG lưu state local — chúng
 * tính ra giá trị mới và commit vào `style` qua `onCommit`. Cả preview lẫn
 * backend ASS đọc từ cùng 1 nguồn → rendering 1-1.
 *
 * Props:
 *   segments       — list segments để tìm active theo currentTime
 *   currentTime    — sec
 *   style          — subtitle_style canonical (xem schema)
 *   placeholder    — text mẫu khi chưa có segment
 *   onCommit(patch)— callback để merge patch vào subtitle_style
 *   videoWidth     — px thật của video (để map px canonical → css preview)
 *   videoHeight    — px thật của video
 */

const ANCHOR_Y = { top: 0, center: -50, bottom: -100 };

export default function SubtitleOverlay({
  segments, currentTime, style, placeholder, onCommit,
  videoWidth = 1920, videoHeight = 1080,
}) {
  const containerRef = useRef(null);
  const wrapperRef = useRef(null);
  const boxRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState(false);
  const [snapGuides, setSnapGuides] = useState({ x: null, y: null });

  // ── Canonical values từ style ─────────────────────────────
  const fontSize = style.font_size || 24;                    // px video
  const marginV = style.margin_v ?? 30;                      // px video
  const maxWidthPct = style.max_width_pct ?? null;           // % video width (null = auto)
  const rotation = style.rotation || 0;                      // độ
  const position = style.position || 'bottom';
  const hasCustom = style.custom_x != null && style.custom_y != null;
  const posX = hasCustom ? style.custom_x : 50;
  const defaultYPct = position === 'top'
    ? (marginV / videoHeight) * 100
    : position === 'center'
    ? 50
    : 100 - (marginV / videoHeight) * 100;
  const posY = hasCustom ? style.custom_y : defaultYPct;
  const anchorY = hasCustom
    ? (posY < 33 ? 0 : posY < 66 ? -50 : -100)
    : ANCHOR_Y[position];

  const activeSeg = segments.find(
    s => currentTime >= s.start && currentTime < s.end && s.translated_text?.trim()
  );

  // ── Click ngoài wrapper → bỏ active (ẩn handles) ──────────
  useEffect(() => {
    if (!active) return;
    const onDocDown = (e) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target)) setActive(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [active]);

  // ── Body drag → commit custom_x, custom_y ────────────────
  const onBodyMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setActive(true);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startMx = e.clientX, startMy = e.clientY;
    const startPx = posX, startPy = posY;
    const SNAP_X = [5, 25, 50, 75, 95];
    const SNAP_Y = [6, 25, 50, 75, 94];
    const THRESHOLD = 2.5;

    const onMove = (ev) => {
      let nx = startPx + ((ev.clientX - startMx) / rect.width) * 100;
      let ny = startPy + ((ev.clientY - startMy) / rect.height) * 100;
      nx = Math.max(2, Math.min(98, nx));
      ny = Math.max(2, Math.min(98, ny));
      let gx = null, gy = null;
      for (const t of SNAP_X) if (Math.abs(nx - t) < THRESHOLD) { nx = t; gx = t; break; }
      for (const t of SNAP_Y) if (Math.abs(ny - t) < THRESHOLD) { ny = t; gy = t; break; }
      onCommit?.({ custom_x: Number(nx.toFixed(2)), custom_y: Number(ny.toFixed(2)) });
      setSnapGuides({ x: gx, y: gy });
    };
    const onUp = () => {
      setSnapGuides({ x: null, y: null });
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [posX, posY, onCommit]);

  // ── Corner resize → commit font_size (trực tiếp, không multiplier) ──
  const onCornerMouseDown = useCallback((corner) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startFont = fontSize;
    const sx = corner.includes('e') ? 1 : -1;
    const sy = corner.includes('s') ? 1 : -1;
    const onMove = (ev) => {
      // Delta 200px chéo = +50% font size (linh hoạt đều)
      const dx = (ev.clientX - startX) * sx;
      const dy = (ev.clientY - startY) * sy;
      const delta = (dx + dy) / 8;   // 8 px dịch = +1 font_size
      const next = Math.max(10, Math.min(200, startFont + delta));
      onCommit?.({ font_size: Math.round(next) });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [fontSize, onCommit]);

  // ── E/W resize → commit max_width_pct ────────────────────
  const onEdgeMouseDown = useCallback((side) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const startX = e.clientX;
    const containerRect = containerRef.current?.getBoundingClientRect();
    const containerW = containerRect ? containerRect.width : box.width;
    const startPct = (box.width / containerW) * 100;
    const sign = side === 'e' ? 1 : -1;
    const onMove = (ev) => {
      const dxPct = ((ev.clientX - startX) * sign * 2 / containerW) * 100;
      const next = Math.max(10, Math.min(100, startPct + dxPct));
      onCommit?.({ max_width_pct: Number(next.toFixed(1)) });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [onCommit]);

  // ── Rotate → commit rotation ─────────────────────────────
  const onRotateMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
    const startRot = rotation;
    const onMove = (ev) => {
      const a = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
      let next = startRot + (a - startAngle);
      if (ev.shiftKey) next = Math.round(next / 15) * 15;
      onCommit?.({ rotation: Number(next.toFixed(1)) });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [rotation, onCommit]);

  // ── Scroll trên text → đổi font_size ─────────────────────
  const onWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 2 : -2;
    const next = Math.max(10, Math.min(200, fontSize + delta));
    onCommit?.({ font_size: next });
  }, [fontSize, onCommit]);

  // ── Nội dung text ────────────────────────────────────────
  let subtitleText = '';
  if (activeSeg) {
    const rawText = activeSeg.translated_text || '';
    subtitleText = rawText
      .replace(/^[\w\d]+[.):]\s*\[\w+\]\s*/g, '')
      .replace(/^\[\w+\]\s*/g, '')
      .replace(/^\d+[.):]\s+/g, '')
      .trim();
  } else if (placeholder) {
    subtitleText = placeholder;
  }
  if (!subtitleText) return null;
  const isPlaceholder = !activeSeg && !!placeholder;

  // ── CSS: map canonical video px → preview px ─────────────
  // Video có tỷ lệ thật (videoW × videoH). Preview container tự scale
  // video để contain. Css fontSize em dùng % của video height để khớp
  // ASS ScaledBorderAndShadow rendering.
  const cssFontSize = `${(fontSize / videoHeight) * 100}cqh`; // container query
  // Fallback nếu trình duyệt chưa support cqh
  const fallbackFontSize = `calc(${fontSize / videoHeight} * 100%)`;

  const bgHex = Math.round((style.bg_opacity ?? 0.6) * 255).toString(16).padStart(2, '0');
  const showHandles = active || hovered;
  const hasBg = (style.bg_opacity ?? 0.6) > 0.01;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        zIndex: 10, overflow: 'hidden',
        containerType: 'size',   // cho cqh/cqw hoạt động
      }}
    >
      {/* Snap guides khi đang drag */}
      {snapGuides.x != null && (
        <div style={{
          position: 'absolute', left: `${snapGuides.x}%`, top: 0, bottom: 0,
          width: 1, background: '#facc15', pointerEvents: 'none',
          boxShadow: '0 0 6px rgba(250,204,21,0.6)',
        }} />
      )}
      {snapGuides.y != null && (
        <div style={{
          position: 'absolute', top: `${snapGuides.y}%`, left: 0, right: 0,
          height: 1, background: '#facc15', pointerEvents: 'none',
          boxShadow: '0 0 6px rgba(250,204,21,0.6)',
        }} />
      )}

      <div
        ref={wrapperRef}
        style={{
          position: 'absolute',
          left: `${posX}%`,
          top: `${posY}%`,
          transform: `translate(-50%, ${anchorY}%) rotate(${rotation}deg)`,
          transformOrigin: 'center center',
          pointerEvents: 'auto',
          width: maxWidthPct ? `${maxWidthPct}%` : 'auto',
          maxWidth: maxWidthPct ? undefined : '85%',
        }}
        onMouseEnter={() => { setHovered(true); setActive(true); }}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          ref={boxRef}
          onMouseDown={onBodyMouseDown}
          onWheel={onWheel}
          style={{
            cursor: 'grab',
            userSelect: 'none',
            fontFamily: style.font_family || 'Arial',
            fontSize: `${(fontSize / videoHeight) * 100}cqh`,
            fontWeight: style.font_bold ? 'bold' : 'normal',
            fontStyle: style.font_italic ? 'italic' : 'normal',
            color: style.font_color || '#fff',
            backgroundColor: hasBg ? `${style.bg_color || '#000'}${bgHex}` : 'transparent',
            padding: '0.2em 0.6em',
            borderRadius: 4,
            textShadow: (style.shadow_offset || 0) > 0
              ? `${Math.min(style.shadow_offset, 6) * 0.03}em ${Math.min(style.shadow_offset, 6) * 0.03}em ${Math.min(style.shadow_offset, 6) * 0.02}em ${style.outline_color || '#000'}`
              : 'none',
            WebkitTextStroke: (style.outline_width || 0) > 0
              ? `${Math.min(style.outline_width, 4) * 0.025}em ${style.outline_color || '#000'}`
              : 'none',
            paintOrder: 'stroke fill',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            textAlign: 'center',
            lineHeight: 1.3,
            opacity: isPlaceholder ? 0.85 : 1,
            outline: showHandles ? '1px dashed rgba(255,255,255,0.7)' : 'none',
            outlineOffset: 4,
          }}
        >
          {subtitleText}
        </div>

        {/* Handles */}
        {showHandles && (
          <>
            <CornerDot pos="nw" onMouseDown={onCornerMouseDown('nw')} />
            <CornerDot pos="ne" onMouseDown={onCornerMouseDown('ne')} />
            <CornerDot pos="sw" onMouseDown={onCornerMouseDown('sw')} />
            <CornerDot pos="se" onMouseDown={onCornerMouseDown('se')} />
            <EdgeBar side="e" onMouseDown={onEdgeMouseDown('e')} />
            <EdgeBar side="w" onMouseDown={onEdgeMouseDown('w')} />
            <div
              onMouseDown={onRotateMouseDown}
              style={{
                position: 'absolute', left: '50%', top: -38,
                width: 16, height: 16, marginLeft: -8,
                borderRadius: '50%', background: '#fff',
                border: '2px solid var(--accent, #6c5ce7)',
                cursor: 'grab', pointerEvents: 'auto',
                boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
              }}
              title="Kéo để xoay (giữ Shift = snap 15°)"
            />
            <div
              style={{
                position: 'absolute', left: '50%', top: -22,
                width: 1, height: 22, marginLeft: -0.5,
                background: 'rgba(255,255,255,0.6)', pointerEvents: 'none',
              }}
            />
          </>
        )}
      </div>

      {/* Info badge */}
      {(fontSize !== 24 || rotation !== 0 || maxWidthPct != null || hasCustom) && showHandles && (
        <div style={{
          position: 'absolute', bottom: 8, right: 8,
          background: 'rgba(0,0,0,0.6)', color: '#aaa',
          padding: '2px 6px', borderRadius: 3, fontSize: 10,
          pointerEvents: 'none',
        }}>
          {fontSize}px
          {rotation !== 0 && ` · ${Math.round(rotation)}°`}
          {maxWidthPct != null && ` · w${Math.round(maxWidthPct)}%`}
        </div>
      )}
    </div>
  );
}

function EdgeBar({ side, onMouseDown }) {
  const base = {
    position: 'absolute', top: '50%', marginTop: -10,
    width: 6, height: 20, borderRadius: 2,
    background: '#fff',
    border: '2px solid var(--accent, #6c5ce7)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
    pointerEvents: 'auto', cursor: 'ew-resize',
  };
  const off = side === 'e' ? { right: -6 } : { left: -6 };
  return <div onMouseDown={onMouseDown} style={{ ...base, ...off }} />;
}

function CornerDot({ pos, onMouseDown }) {
  const base = {
    position: 'absolute', width: 14, height: 14, borderRadius: 3,
    background: '#fff',
    border: '2px solid var(--accent, #6c5ce7)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
    pointerEvents: 'auto',
  };
  const offsets = {
    nw: { left: -10, top: -10, cursor: 'nwse-resize' },
    ne: { right: -10, top: -10, cursor: 'nesw-resize' },
    sw: { left: -10, bottom: -10, cursor: 'nesw-resize' },
    se: { right: -10, bottom: -10, cursor: 'nwse-resize' },
  };
  return <div onMouseDown={onMouseDown} style={{ ...base, ...offsets[pos] }} />;
}
