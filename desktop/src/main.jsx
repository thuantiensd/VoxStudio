import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './sentry'  // Init Sentry TRƯỚC khi import App — bắt error ngay cả trong render đầu
import './index.css'
import App from './App.jsx'
import { purgeLegacyUnscopedData } from './services/userScope'

// Một lần lúc boot: dọn các key dữ liệu cũ chưa scope theo user (di sản
// từ bản trước). Tránh lộ data của user cũ ra user mới khi đăng nhập.
purgeLegacyUnscopedData()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
