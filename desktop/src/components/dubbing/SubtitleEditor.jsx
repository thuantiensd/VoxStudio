import { useState } from 'react';
import { Type, Palette, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, AlignVerticalJustifyCenter } from 'lucide-react';

const labelStyle = { color: 'var(--text-secondary)' };
const inputStyle = { background: 'var(--bg-surface)', border: '1px solid #2a2a40', color: 'var(--text-primary)' };

const FONTS = [
  'Arial', 'Helvetica', 'Roboto', 'Noto Sans', 'Open Sans',
  'Times New Roman', 'Georgia', 'Courier New', 'Verdana',
  'Noto Sans CJK', 'Source Han Sans',
];

export default function SubtitleEditor({ style, onChange }) {
  const [expanded, setExpanded] = useState(true);

  const update = (key, value) => {
    onChange({ ...style, [key]: value });
  };

  return (
    <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40' }}>
      <button onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 w-full text-left text-sm font-medium mb-3">
        <Type size={16} style={{ color: 'var(--accent)' }} />
        Subtitle Style
        <span className="text-xs ml-auto" style={labelStyle}>{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="space-y-4">
          {/* Font Family + Size */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs mb-1" style={labelStyle}>Font</label>
              <select value={style.font_family} onChange={e => update('font_family', e.target.value)}
                className="w-full p-2 rounded text-sm" style={inputStyle}>
                {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="w-20">
              <label className="block text-xs mb-1" style={labelStyle}>Size</label>
              <input type="number" min={12} max={72} value={style.font_size}
                onChange={e => update('font_size', parseInt(e.target.value) || 24)}
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

          {/* Colors */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs mb-1" style={labelStyle}>Font Color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={style.font_color}
                  onChange={e => update('font_color', e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer" style={{ border: 'none', padding: 0 }} />
                <input type="text" value={style.font_color}
                  onChange={e => update('font_color', e.target.value)}
                  className="flex-1 p-1.5 rounded text-xs font-mono" style={inputStyle} />
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-xs mb-1" style={labelStyle}>Background</label>
              <div className="flex items-center gap-2">
                <input type="color" value={style.bg_color}
                  onChange={e => update('bg_color', e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer" style={{ border: 'none', padding: 0 }} />
                <input type="text" value={style.bg_color}
                  onChange={e => update('bg_color', e.target.value)}
                  className="flex-1 p-1.5 rounded text-xs font-mono" style={inputStyle} />
              </div>
            </div>
          </div>

          {/* BG Opacity */}
          <div>
            <label className="block text-xs mb-1" style={labelStyle}>
              Background Opacity: {Math.round(style.bg_opacity * 100)}%
            </label>
            <input type="range" min={0} max={1} step={0.05} value={style.bg_opacity}
              onChange={e => update('bg_opacity', parseFloat(e.target.value))}
              className="w-full" />
          </div>

          {/* Outline */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs mb-1" style={labelStyle}>Outline Color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={style.outline_color}
                  onChange={e => update('outline_color', e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer" style={{ border: 'none', padding: 0 }} />
                <input type="text" value={style.outline_color}
                  onChange={e => update('outline_color', e.target.value)}
                  className="flex-1 p-1.5 rounded text-xs font-mono" style={inputStyle} />
              </div>
            </div>
            <div className="w-24">
              <label className="block text-xs mb-1" style={labelStyle}>Width</label>
              <input type="number" min={0} max={6} value={style.outline_width}
                onChange={e => update('outline_width', parseInt(e.target.value) || 0)}
                className="w-full p-2 rounded text-sm text-center" style={inputStyle} />
            </div>
            <div className="w-24">
              <label className="block text-xs mb-1" style={labelStyle}>Shadow</label>
              <input type="number" min={0} max={6} value={style.shadow_offset}
                onChange={e => update('shadow_offset', parseInt(e.target.value) || 0)}
                className="w-full p-2 rounded text-sm text-center" style={inputStyle} />
            </div>
          </div>

          {/* Position */}
          <div>
            <label className="block text-xs mb-1.5" style={labelStyle}>Position</label>
            <div className="flex gap-2">
              {[
                { value: 'top', Icon: AlignVerticalJustifyStart, label: 'Top' },
                { value: 'center', Icon: AlignVerticalJustifyCenter, label: 'Center' },
                { value: 'bottom', Icon: AlignVerticalJustifyEnd, label: 'Bottom' },
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
          <div className="w-32">
            <label className="block text-xs mb-1" style={labelStyle}>Margin V (px)</label>
            <input type="number" min={0} max={200} value={style.margin_v}
              onChange={e => update('margin_v', parseInt(e.target.value) || 0)}
              className="w-full p-2 rounded text-sm text-center" style={inputStyle} />
          </div>

          {/* Preview */}
          <div className="rounded-lg overflow-hidden" style={{ background: '#111', position: 'relative', height: 80 }}>
            <div style={{
              position: 'absolute',
              left: '50%', transform: 'translateX(-50%)',
              ...(style.position === 'top' ? { top: 8 } : style.position === 'center' ? { top: '50%', transform: 'translate(-50%, -50%)' } : { bottom: 8 }),
              fontFamily: style.font_family,
              fontSize: Math.min(style.font_size, 18),
              fontWeight: style.font_bold ? 'bold' : 'normal',
              fontStyle: style.font_italic ? 'italic' : 'normal',
              color: style.font_color,
              backgroundColor: `${style.bg_color}${Math.round(style.bg_opacity * 255).toString(16).padStart(2, '0')}`,
              padding: '2px 8px',
              borderRadius: 3,
              textShadow: style.shadow_offset > 0 ? `${style.shadow_offset}px ${style.shadow_offset}px 0 ${style.outline_color}` : 'none',
              WebkitTextStroke: style.outline_width > 0 ? `${Math.min(style.outline_width, 1)}px ${style.outline_color}` : 'none',
              whiteSpace: 'nowrap',
            }}>
              Preview subtitle text
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
