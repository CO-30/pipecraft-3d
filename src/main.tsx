import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadFeedback } from './feedback/feedback'

void loadFeedback() // 共通の要望欄。起動から操作を記録する（読み込めなくてもアプリは動く）

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
