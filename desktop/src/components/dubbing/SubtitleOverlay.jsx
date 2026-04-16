import { useState, useRef, useCallback, useEffect } from 'react';

const Y_MAP = { top: 15, center: 50, bottom: 55 };

export default function SubtitleOverlay({ segments, currentTime, style }) {
  const [dragOffset, setDragOffset] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [fontScale, setFontScale] = useState(1.0); // scroll to resize
  const containerRef = useRef(null);
  const dragStart = useRef(null);

  const defaultX = 50;
  const defaultY = Y_MAP[style.position] ?? 55;
  const posX = dragOffset ? dragOffset.x : defaultX;
  const posY = dragOffset ? dragOffset.y : defaultY;

  // Find active segment
  const activeSeg = segments.find(
    s => currentTime >= s.start && currentTime < s.end && s.translated_text?.trim()
  );

  // Reset drag offset when position setting changes
  useEffect(() => {
    setDragOffset(null);
  }, [style.position]);

  // Drag handlers
  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragStart.current = {
      mx: e.clientX, my: e.clientY,
      px: posX, py: posY,
      w: rect.width, h: rect.height,
    };
    setDragging(true);
  }, [posX, posY]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const d = dragStart.current;
      if (!d) return;
      setDragOffset({
        x: Math.max(5, Math.min(95, d.px + ((e.clientX - d.mx) / d.w) * 100)),
        y: Math.max(5, Math.min(95, d.py + ((e.clientY - d.my) / d.h) * 100)),
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  // Scroll to resize subtitle font
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setFontScale(prev => {
      const next = prev + (e.deltaY < 0 ? 0.1 : -0.1);
      return Math.max(0.5, Math.min(3.0, next));
    });
  }, []);

  if (!activeSeg) return null;

  // Clean subtitle text — strip any leftover "N. [emotion]" or "1. [emotion]" prefixes
  const rawText = activeSeg.translated_text || '';
  const subtitleText = rawText
    .replace(/^[\w\d]+[.):\s]+\[\w+\]\s*/g, '')  // "N. [neutral] text" or "1. [neutral] text"
    .replace(/^\[\w+\]\s*/g, '')                   // "[neutral] text"
    .replace(/^[\w\d]+[.):\s]+/g, '')              // "N. text" or "1. text"
    .trim();

  if (!subtitleText) return null;

  const baseFontSize = style.font_size || 24;
  const fontSize = Math.round(baseFontSize * fontScale);
  const bgHex = Math.round((style.bg_opacity ?? 0.6) * 255).toString(16).padStart(2, '0');

  return (
    <div ref={containerRef}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10, overflow: 'hidden' }}>
      <div
        onMouseDown={onMouseDown}
        onWheel={handleWheel}
        style={{
          position: 'absolute',
          left: `${posX}%`, top: `${posY}%`,
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'auto',
          cursor: dragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          fontFamily: style.font_family || 'Arial',
          fontSize,
          fontWeight: style.font_bold ? 'bold' : 'normal',
          fontStyle: style.font_italic ? 'italic' : 'normal',
          color: style.font_color || '#fff',
          backgroundColor: `${style.bg_color || '#000'}${bgHex}`,
          padding: '4px 12px',
          borderRadius: 4,
          textShadow: (style.shadow_offset || 0) > 0
            ? `${style.shadow_offset}px ${style.shadow_offset}px 0 ${style.outline_color || '#000'}`
            : '1px 1px 3px rgba(0,0,0,0.9)',
          WebkitTextStroke: (style.outline_width || 0) > 0
            ? `${Math.min(style.outline_width, 1.5)}px ${style.outline_color || '#000'}` : 'none',
          whiteSpace: 'pre-wrap',
          textAlign: 'center',
          maxWidth: '85%',
          lineHeight: 1.4,
          transition: dragging ? 'none' : 'font-size 0.15s ease',
        }}>
        {subtitleText}
      </div>

      {/* Font size indicator (shows briefly on scroll) */}
      {fontScale !== 1.0 && (
        <div style={{
          position: 'absolute', bottom: 8, right: 8,
          background: 'rgba(0,0,0,0.6)', color: '#aaa',
          padding: '2px 6px', borderRadius: 3, fontSize: 10,
          pointerEvents: 'none',
        }}>
          {fontSize}px
        </div>
      )}
    </div>
  );
}
