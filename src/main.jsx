import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import KebiaoMotionProvider from './components/KebiaoMotionProvider.jsx'
// 星表 type: Geist + Noto Sans SC for text, Geist Mono for codes. Noto Serif SC only draws the 课标 glyph in the sky.
import '@fontsource-variable/noto-sans-sc/wght.css'
import '@fontsource-variable/geist-mono/wght.css'
import '@fontsource-variable/noto-serif-sc/wght.css'
import './styles/fonts.css'
import './index.css'
import { capturePrerenderSnapshot } from './seo/prerenderSnapshot.js'

// After a deploy, a page opened earlier asks for script/CSS files that no longer exist.
// Reload once to pick up the new build; the guard stops a reload loop if the files really are missing.
// A page usually misses several files (script + CSS): once the reload is on its way, the rest wait for it too.
let reloading = false
window.addEventListener('vite:preloadError', event => {
    if (reloading) {
        event.preventDefault()
        return
    }
    try {
        const last = Number(sessionStorage.getItem('kb-chunk-reload') || 0)
        if (Date.now() - last < 60_000) return
        sessionStorage.setItem('kb-chunk-reload', String(Date.now()))
    } catch {
        return
    }
    reloading = true
    event.preventDefault()
    window.location.reload()
})

// Rendering clears #root, so keep the prerendered page content first.
capturePrerenderSnapshot()

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <KebiaoMotionProvider>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </KebiaoMotionProvider>
    </React.StrictMode>,
)
