import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './sentry'  // Init Sentry TRƯỚC khi import App — bắt error ngay cả trong render đầu
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
