import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { checkHealth } from '../services/api';

export default function SettingsPage() {
  const [health, setHealth] = useState(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    const r = await checkHealth();
    setHealth(r);
    setChecking(false);
  };

  useEffect(() => { check(); }, []);

  return (
    <div className="p-6 mx-auto" style={{ maxWidth: '720px', width: '100%' }}>
      <h2 className="text-2xl font-bold mb-6">Settings</h2>

      {/* Server status */}
      <div className="p-4 rounded-lg mb-4" style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40' }}>
        <div className="flex items-center justify-between mb-3">
          <p className="font-medium text-sm">Server Status</p>
          <button onClick={check} disabled={checking}
            className="text-xs px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
            {checking ? <Loader2 size={12} className="animate-spin" /> : 'Refresh'}
          </button>
        </div>
        {health ? (
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full"
              style={{ background: health.status === 'ok' ? 'var(--success)' : 'var(--danger)' }} />
            <span className="text-sm" style={{ color: health.status === 'ok' ? 'var(--success)' : 'var(--danger)' }}>
              {health.status === 'ok' ? 'Connected' : 'Offline'}
            </span>
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Checking...</p>
        )}
        <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
          http://localhost:8000
        </p>
      </div>

      {/* Server info */}
      {health?.status === 'ok' && (
        <div className="p-4 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40' }}>
          <p className="font-medium text-sm mb-3">Server Info</p>
          <div className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {health.device && <p>Device: <span style={{ color: 'var(--text-primary)' }}>{health.device}</span></p>}
            {health.models_loaded !== undefined && (
              <p>Models: <span style={{ color: 'var(--text-primary)' }}>{health.models_loaded ? 'Loaded' : 'Not loaded'}</span></p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
