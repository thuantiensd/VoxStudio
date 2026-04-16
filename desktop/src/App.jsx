import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import TTSPage from './pages/TTSPage';
import VoiceClonePage from './pages/VoiceClonePage';
import VoiceLibraryPage from './pages/VoiceLibraryPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import DubbingPage from './pages/DubbingPage';

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<TTSPage />} />
            <Route path="/dubbing" element={<DubbingPage />} />
            <Route path="/clone" element={<VoiceClonePage />} />
            <Route path="/library" element={<VoiceLibraryPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
