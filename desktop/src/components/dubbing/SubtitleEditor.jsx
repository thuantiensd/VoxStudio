import { useState, useEffect } from 'react';
import { Type, Palette, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, AlignVerticalJustifyCenter } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';

const labelStyle = { color: 'var(--text-secondary)' };
const inputStyle = { background: 'var(--bg-surface)', border: '1px solid #2a2a40', color: 'var(--text-primary)' };

const FONTS = [
  'Arial', 'Helvetica', 'Roboto', 'Noto Sans', 'Open Sans',
  'Times New Roman', 'Georgia', 'Courier New', 'Verdana',
  'Noto Sans CJK', 'Source Han Sans',
];

/**
 * ColorField — swatch picker + hex input. Hex input giữ draft cục bộ để
 * user gõ không bị rerender ngắt; commit khi Enter/Blur và hợp lệ.
 */
function ColorField({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const isValid = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(draft);
  const commit = () => {
    if (isValid) onCommit(draft);
    else setDraft(value); // invalid → revert
  };
  return (
    <div className="flex items-center gap-2 min-w-0">
      <input
        type="color"
        value={value}
        onChange={e => onCommit(e.target.value)}
        className="w-8 h-8 rounded cursor-pointer flex-shrink-0"
        style={{ border: 'none', padding: 0 }}
      />
      <input
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.currentTarget.blur(); }
          if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur(); }
        }}
        spellCheck={false}
        className="flex-1 min-w-0 p-1.5 rounded text-xs font-mono"
        style={{
          background: 'var(--bg-surface)',
          border: `1px solid ${isValid ? '#2a2a40' : '#ef4444'}`,
          color: 'var(--text-primary)',
        }}
      />
    </div>
  );
}

/**
 * NumberField — giữ draft string cục bộ để user có thể xoá trống/gõ lại
 * không bị fallback về giá trị cũ và không bị rebound caret.
 * Commit khi blur/Enter; clamp vào [min, max]. Empty/invalid → giữ value cũ.
 */
function NumberField({ value, min, max, onCommit, className, style }) {
  const [draft, setDraft] = useState(String(value ?? ''));
  useEffect(() => { setDraft(String(value ?? '')); }, [value]);
  const commit = () => {
    const s = draft.trim();
    if (s === '') { setDraft(String(value ?? '')); return; }
    let n = parseInt(s, 10);
    if (!Number.isFinite(n)) { setDraft(String(value ?? '')); return; }
    if (typeof min === 'number') n = Math.max(min, n);
    if (typeof max === 'number') n = Math.min(max, n);
    onCommit(n);
    setDraft(String(n));
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft}
      onChange={e => setDraft(e.target.value.replace(/[^\d-]/g, ''))}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(String(value ?? '')); e.currentTarget.blur(); }
      }}
      className={className}
      style={style}
    />
  );
}

export default function SubtitleEditor({ style, onChange }) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);

  const update = (key, value) => {
    onChange({ ...style, [key]: value });
  };

  return (
    <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40' }}>
      <button onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 w-full text-left text-sm font-medium mb-3">
        <Type size={16} style={{ color: 'var(--accent)' }} />
        {t('studio.subtitleEditor.title')}
        <span className="text-xs ml-auto" style={labelStyle}>{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="space-y-4">
          {/* Font Family + Size */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs mb-1" style={labelStyle}>{t('studio.subtitleEditor.font')}</label>
              <select value={style.font_family} onChange={e => update('font_family', e.target.value)}
                className="w-full p-2 rounded text-sm" style={inputStyle}>
                {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="w-20">
              <label className="block text-xs mb-1" style={labelStyle}>{t('studio.subtitleEditor.size')}</label>
              <NumberField value={style.font_size} min={12} max={72}
                onCommit={v => update('font_size', v)}
                className="w-full p-2 rounded text-sm text-center" style={inputStyle} />
            </div>
          </div>

          {/* Bold / Italic */}
          <div className="flex gap-2">
            <button onClick={() => update('font_bold', !style.font_bold)}
              className="px-3 py-1.5 rounded text-sm font-bold"
              style={{
                ...inputStyle,
                background: style.font_bold ? 'var(--accent)' : 'var(--bg-surface)',
                color: style.font_bold ? '#fff' : 'var(--text-secondary)',
              }}>
              B
            </button>
            <button onClick={() => update('font_italic', !style.font_italic)}
              className="px-3 py-1.5 rounded text-sm italic"
              style={{
                ...inputStyle,
                background: style.font_italic ? 'var(--accent)' : 'var(--bg-surface)',
                color: style.font_italic ? '#fff' : 'var(--text-secondary)',
              }}>
              I
            </button>
          </div>

          {/* Colors — grid để mỗi cột bị hẹp cũng không tràn */}
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="block text-xs mb-1" style={labelStyle}>{t('studio.subtitleEditor.fontColor')}</label>
              <ColorField value={style.font_color}
                onCommit={v => update('font_color', v)} />
            </div>
            <div className="min-w-0">
              <label className="block text-xs mb-1" style={labelStyle}>{t('studio.subtitleEditor.bgColor')}</label>
              <ColorField value={style.bg_color}
                onCommit={v => update('bg_color', v)} />
            </div>
          </div>

          {/* Hiệu ứng chữ — preset nhanh */}
          <div>
            <label className="block text-xs mb-1.5" style={labelStyle}>{t('studio.subtitleEditor.effect')}</label>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { key: 'none', label: t('studio.subtitleEditor.effectNone'), shadow: 0, outline: 0 },
                { key: 'shadow', label: t('studio.subtitleEditor.effectShadow'), shadow: 2, outline: 0 },
                { key: 'outline', label: t('studio.subtitleEditor.effectOutline'), shadow: 0, outline: 2 },
                { key: 'both', label: t('studio.subtitleEditor.effectBoth'), shadow: 2, outline: 2 },
              ].map(p => {
                const active =
                  (style.shadow_offset || 0) === p.shadow &&
                  (style.outline_width || 0) === p.outline;
                return (
                  <button key={p.key} type="button"
                    onClick={() => onChange({
                      ...style,
                      shadow_offset: p.shadow,
                      outline_width: p.outline,
                    })}
                    className="rounded py-1.5 text-xs transition-colors"
                    style={{
                      background: active ? 'var(--accent)' : 'var(--bg-surface)',
                      color: active ? '#fff' : 'var(--text-secondary)',
                      border: '1px solid #2a2a40',
                    }}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* BG Opacity */}
          <div>
            <label className="block text-xs mb-1" style={labelStyle}>
              {t('studio.subtitleEditor.bgOpacity')}: {Math.round(style.bg_opacity * 100)}%
            </label>
            <input type="range" min={0} max={1} step={0.05} value={style.bg_opacity}
              onChange={e => update('bg_opacity', parseFloat(e.target.value))}
              className="w-full" />
          </div>

          {/* Outline — chỉ hiện khi có hiệu ứng (viền hoặc bóng) */}
          {((style.outline_width || 0) > 0 || (style.shadow_offset || 0) > 0) && (
            <div className="flex gap-3 min-w-0">
              <div className="flex-1 min-w-0">
                <label className="block text-xs mb-1" style={labelStyle}>
                  {t('studio.subtitleEditor.outlineColor')}
                </label>
                <ColorField value={style.outline_color}
                  onCommit={v => update('outline_color', v)} />
              </div>
              <div className="w-20">
                <label className="block text-xs mb-1" style={labelStyle}>{t('studio.subtitleEditor.outlineWidth')}</label>
                <NumberField value={style.outline_width} min={0} max={6}
                  onCommit={v => update('outline_width', v)}
                  className="w-full p-2 rounded text-sm text-center" style={inputStyle} />
              </div>
              <div className="w-20">
                <label className="block text-xs mb-1" style={labelStyle}>{t('studio.subtitleEditor.shadow')}</label>
                <NumberField value={style.shadow_offset} min={0} max={6}
                  onCommit={v => update('shadow_offset', v)}
                  className="w-full p-2 rounded text-sm text-center" style={inputStyle} />
              </div>
            </div>
          )}

          {/* Position */}
          <div>
            <label className="block text-xs mb-1.5" style={labelStyle}>{t('studio.subtitleEditor.position')}</label>
            <div className="flex gap-2">
              {[
                { value: 'top', Icon: AlignVerticalJustifyStart, label: t('studio.subtitleEditor.posTop') },
                { value: 'center', Icon: AlignVerticalJustifyCenter, label: t('studio.subtitleEditor.posCenter') },
                { value: 'bottom', Icon: AlignVerticalJustifyEnd, label: t('studio.subtitleEditor.posBottom') },
              ].map(({ value, Icon, label }) => (
                <button key={value} onClick={() => update('position', value)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs"
                  style={{
                    ...inputStyle,
                    background: style.position === value ? 'var(--accent)' : 'var(--bg-surface)',
                    color: style.position === value ? '#fff' : 'var(--text-secondary)',
                  }}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          </div>

          {/* Margin */}
          <div>
            <label className="block text-xs mb-1" style={labelStyle}>{t('studio.subtitleEditor.marginV')}</label>
            <NumberField value={style.margin_v} min={0} max={200}
              onCommit={v => update('margin_v', v)}
              className="w-32 p-2 rounded text-sm text-center" style={inputStyle} />
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
              {t('studio.subtitleEditor.marginVHint')}
            </p>
          </div>

          {/* Reset position button — chỉ hiện khi user đã custom drag/scale/rotate */}
          {(style.custom_x != null || (style.scale && style.scale !== 1) || (style.rotation && style.rotation !== 0)) && (
            <button
              onClick={() => onChange({
                ...style,
                custom_x: null, custom_y: null, scale: 1, rotation: 0,
              })}
              className="text-xs underline"
              style={{ color: 'var(--text-secondary)' }}
            >
              ↺ Reset vị trí/scale/xoay phụ đề
            </button>
          )}

          {/* Mini preview — chỉ thị vị trí phụ đề trong khung video */}
          <div>
            <label className="block text-xs mb-1.5" style={labelStyle}>{t('studio.subtitleEditor.framePosition')}</label>
            <div
              className="rounded-md relative overflow-hidden"
              style={{
                background: '#111',
                border: '1px solid #2a2a40',
                height: 54,
                width: '100%',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  ...(style.position === 'top'
                    ? { top: 6 }
                    : style.position === 'center'
                    ? { top: '50%', transform: 'translate(-50%, -50%)' }
                    : { bottom: 6 }),
                  padding: '2px 8px',
                  borderRadius: 2,
                  backgroundColor: `${style.bg_color}${Math.round(style.bg_opacity * 255).toString(16).padStart(2, '0')}`,
                  color: style.font_color,
                  fontFamily: style.font_family,
                  fontSize: 10,
                  fontWeight: style.font_bold ? 'bold' : 'normal',
                  fontStyle: style.font_italic ? 'italic' : 'normal',
                  whiteSpace: 'nowrap',
                  textShadow: (style.shadow_offset || 0) > 0
                    ? `${Math.min(style.shadow_offset, 6) * 0.5}px ${Math.min(style.shadow_offset, 6) * 0.5}px ${Math.min(style.shadow_offset, 6) * 0.4}px ${style.outline_color || '#000'}`
                    : 'none',
                  WebkitTextStroke: (style.outline_width || 0) > 0
                    ? `${Math.min(style.outline_width, 2) * 0.5}px ${style.outline_color || '#000'}`
                    : 'none',
                  paintOrder: 'stroke fill',
                }}
              >
                {t('studio.subtitleEditor.placeholder')}
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
