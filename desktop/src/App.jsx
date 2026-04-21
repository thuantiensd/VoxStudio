import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import AppShell from "./components/shell/AppShell";
import TTSPage from "./pages/TTSPage";
import VoiceClonePage from "./pages/VoiceClonePage";
import VoiceLibraryPage from "./pages/VoiceLibraryPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import StudioPage from "./pages/StudioPage";

import LoginPage from "./auth/LoginPage";
import SignupPage from "./auth/SignupPage";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { I18nProvider } from "./i18n/I18nContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { BatchProvider } from "./batch/BatchContext";
import { ToastProvider } from "./components/ui/Toast";
import ErrorBoundary from "./components/ui/ErrorBoundary";
import GlobalErrorHook from "./components/ui/GlobalErrorHook";

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

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
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
    <I18nProvider>
      <ThemeProvider>
      <ToastProvider>
      <GlobalErrorHook />
      <AuthProvider>
      <BatchProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <Shell />
                </ProtectedRoute>
              }
            />
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
