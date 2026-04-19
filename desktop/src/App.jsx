import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import TTSPage from "./pages/TTSPage";
import VoiceClonePage from "./pages/VoiceClonePage";
import VoiceLibraryPage from "./pages/VoiceLibraryPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import DubbingPage from "./pages/DubbingPage";

import LoginPage from "./auth/LoginPage";
import SignupPage from "./auth/SignupPage";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { I18nProvider } from "./i18n/I18nContext";

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

function AppShell() {
  return (
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
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  );
}
