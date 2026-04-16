import { useState, useEffect } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { listVoices, deleteVoice } from '../services/api';

export default function VoiceLibraryPage() {
  const [voices, setVoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);

  const load = async () => {
    try {
      const r = await listVoices();
      setVoices(r.voices || []);
    } catch {
      setVoices([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    if (!confirm('Delete this voice?')) return;
    setDeleting(id);
    try {
      await deleteVoice(id);
      setVoices(prev => prev.filter(v => v.id !== id));
    } catch {}
    setDeleting(null);
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
        <Loader2 size={18} className="animate-spin" /> Loading voices...
      </div>
    );
  }

  return (
    <div className="p-6 mx-auto" style={{ maxWidth: '860px', width: '100%' }}>
      <h2 className="text-2xl font-bold mb-6">Voice Library</h2>

      {voices.length === 0 ? (
        <div className="text-center py-16" style={{ color: 'var(--text-secondary)' }}>
          <p className="text-lg mb-2">No voices yet</p>
          <p className="text-sm">Go to Voice Clone to create your first voice.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {voices.map(v => (
            <div key={v.id} className="p-4 rounded-lg flex items-center justify-between"
              style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40' }}>
              <div>
                <p className="font-medium text-sm">{v.name}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  {v.id}
                </p>
              </div>
              <button onClick={() => handleDelete(v.id)}
                disabled={deleting === v.id}
                className="p-2 rounded-lg hover:opacity-80 transition-opacity"
                style={{ color: 'var(--danger)' }}>
                {deleting === v.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
