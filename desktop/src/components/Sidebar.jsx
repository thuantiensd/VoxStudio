import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Mic, AudioLines, Library, Clock, Settings, PanelLeftOpen, PanelLeftClose, Film } from 'lucide-react';

const nav = [
  { to: '/', icon: AudioLines, label: 'TTS' },
  { to: '/dubbing', icon: Film, label: 'STT Studio' },
  { to: '/clone', icon: Mic, label: 'Voice Clone' },
  { to: '/library', icon: Library, label: 'Library' },
  { to: '/history', icon: Clock, label: 'History' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

const COLLAPSED_W = 56;
const EXPANDED_W = 210;

export default function Sidebar() {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);

  const expanded = pinned || hovered;
  const width = expanded ? EXPANDED_W : COLLAPSED_W;

  return (
    <>
      {/* Spacer — reserves the collapsed width so main content doesn't shift */}
      <div className="flex-shrink-0" style={{ width: COLLAPSED_W }} />

      {/* Sidebar — positioned fixed-left, overlays when expanded */}
      <aside
        className="fixed top-0 left-0 h-screen flex flex-col z-20 transition-all duration-200"
        style={{
          width,
          background: 'var(--bg-surface)',
          borderRight: '1px solid #2a2a40',
          boxShadow: expanded && !pinned ? '4px 0 24px rgba(0,0,0,.4)' : 'none',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Header */}
        <div className="flex items-center px-3 py-4" style={{ minHeight: 56, gap: 8 }}>
          {expanded ? (
            <div className="flex-1 pl-1 overflow-hidden whitespace-nowrap">
              <h1 className="text-lg font-bold leading-tight" style={{ color: 'var(--accent)' }}>
                VoxStudio
              </h1>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>TTS + STT</p>
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <button onClick={() => setPinned(p => !p)}
            className="p-1.5 rounded-md flex-shrink-0 transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            title={pinned ? 'Collapse sidebar' : 'Pin sidebar'}>
            {pinned ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 mt-1">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                `flex items-center rounded-lg mb-1 text-sm transition-all duration-150 ${isActive ? 'font-medium' : 'hover:opacity-80'}`
              }
              style={({ isActive }) => ({
                background: isActive ? 'var(--accent)' : 'transparent',
                color: isActive ? '#fff' : 'var(--text-secondary)',
                padding: expanded ? '10px 12px' : '10px 0',
                justifyContent: expanded ? 'flex-start' : 'center',
                gap: expanded ? 10 : 0,
              })}
              title={label}
            >
              <Icon size={18} className="flex-shrink-0" />
              {expanded && <span className="whitespace-nowrap overflow-hidden">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        {expanded && (
          <div className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            v0.1.0
          </div>
        )}
      </aside>
    </>
  );
}
