import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { TooltipLayer, PhotoProvider } from './ui.tsx'
import { installExitGhosts } from './exitGhost.ts'

installExitGhosts()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PhotoProvider>
      <App />
    </PhotoProvider>
    <TooltipLayer />
  </StrictMode>,
)
