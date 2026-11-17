import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadFeedback } from './feedback/feedback'
import { startTrail } from './feedback/trail'

void loadFeedback() // 共通の要望欄。起動から操作を記録する（読み込めなくてもアプリは動く）
startTrail() // 道具・階・床下の切り替えと、配管・器具などの数の増減も記録する

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
