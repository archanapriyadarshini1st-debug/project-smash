import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'

const boot = document.getElementById('boot')
// Hide the boot curtain once React has committed and the GL context is warm.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    boot?.classList.add('done')
    setTimeout(() => boot?.remove(), 800)
  })
})

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
