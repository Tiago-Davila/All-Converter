import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { bind } from 'cuelume'
import './index.css'
import { App } from './App'
import { initSound } from './ui/sound/player'

// Sincronizar cuelume con la preferencia persistida ANTES de cualquier play():
// silencio por defecto (FR-031) y veto de prefers-reduced-motion (FR-034).
initSound()

// Cablear todos los atributos data-cuelume-* del DOM (Principio: declarativo primero)
bind()

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
