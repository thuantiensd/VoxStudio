import { useState } from 'react';
import { Clock } from 'lucide-react';

export default function HistoryPage() {
  // History will be stored locally later — placeholder for now
  return (
    <div className="p-6 mx-auto" style={{ maxWidth: '860px', width: '100%' }}>
      <h2 className="text-2xl font-bold mb-6">History</h2>
      <div className="text-center py-16" style={{ color: 'var(--text-secondary)' }}>
        <Clock size={48} className="mx-auto mb-3 opacity-50" />
        <p className="text-lg mb-2">No history yet</p>
        <p className="text-sm">Generated audio will appear here.</p>
      </div>
    </div>
  );
}
