import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/shell/AppShell";
import TTSPage from "./pages/TTSPage";
import VoiceClonePage from "./pages/VoiceClonePage";
import VoiceLibraryPage from "./pages/VoiceLibraryPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import StudioPage from "./pages/StudioPage";
import DownloaderPage from "./pages/DownloaderPage";
import STTPage from "./pages/STTPage";

import LoginPage from "./auth/LoginPage";
import SignupPage from "./auth/SignupPage";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { I18nProvider } from "./i18n/I18nContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { BatchProvider } from "./batch/BatchContext";
import { ToastProvider } from "./components/ui/Toast";
import ErrorBoundary from "./components/ui/ErrorBoundary";
import GlobalErrorHook from "./components/ui/GlobalErrorHook";
import QuotaMonitor from "./components/QuotaMonitor";
import UpdateBanner from "./components/UpdateBanner";

function Shell() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<TTSPage />} />
        <Route path="/studio/*" element={<StudioPage />} />
        <Route path="/dubbing" element={<Navigate to="/studio" replace />} />
        <Route path="/clone" element={<VoiceClonePage />} />
        <Route path="/library" element={<VoiceLibraryPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/downloader" element={<DownloaderPage />} />
        <Route path="/stt" element={<STTPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </AppShell>
  );
}

/**
 * ProtectedRoute — bắt buộc đăng nhập. Chưa auth thì redirect về /login.
 */
function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

/**
 * PublicOnlyRoute — ngược lại: đã login rồi thì không cho quay lại /login,
 * /signup (redirect về home).
 */
function PublicOnlyRoute({ children }) {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
    <I18nProvider>
      <ThemeProvider>
      <ToastProvider>
      <GlobalErrorHook />
      <AuthProvider>
      <QuotaMonitor />
      <UpdateBanner />
      <BatchProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login"  element={<PublicOnlyRoute><LoginPage  /></PublicOnlyRoute>} />
            <Route path="/signup" element={<PublicOnlyRoute><SignupPage /></PublicOnlyRoute>} />
            {/* Bắt buộc đăng nhập để vào app */}
            <Route path="/*" element={<ProtectedRoute><Shell /></ProtectedRoute>} />
          </Routes>
        </BrowserRouter>
      </BatchProvider>
      </AuthProvider>
      </ToastProvider>
      </ThemeProvider>
    </I18nProvider>
    </ErrorBoundary>
  );
}
