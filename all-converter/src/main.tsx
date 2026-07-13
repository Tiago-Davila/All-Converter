import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { bind } from 'cuelume'
import './index.css'
import { App } from './App'

// Cablear todos los atributos data-cuelume-* del DOM (Principio: declarativo primero)
bind()

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
