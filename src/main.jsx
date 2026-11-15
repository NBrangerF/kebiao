import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import KebiaoMotionProvider from './components/KebiaoMotionProvider.jsx'
// 星表 type: Geist + Noto Sans SC for text, Geist Mono for codes. Noto Serif SC only draws the 课标 glyph in the sky.
// The two Chinese faces load after the page (see below), so they don't hold up its own script.
import '@fontsource-variable/geist-mono/wght.css'
import './styles/fonts.css'
import './index.css'
import { capturePrerenderSnapshot } from './seo/prerenderSnapshot.js'

// After a deploy, a page opened earlier asks for script/CSS files that no longer exist.
// Reload once to pick up the new build; the guard stops a reload loop if the files really are missing.
window.addEventListener('vite:preloadError', event => {
    // a Chinese font stylesheet (loaded late, see below) that fails only leaves the phone's own font: no reload
    if (/\/wght-[\w-]+\.css/u.test(String(event.payload?.message))) {
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
    event.preventDefault()
    window.location.reload()
})

// Rendering clears #root, so keep the prerendered page content first.
capturePrerenderSnapshot()

// The Chinese faces are a megabyte or more on a phone. Fetched with the page's script they slow it down by seconds,
// so they start once the page has loaded; until then text shows in the phone's own Chinese font.
function loadChineseFonts() {
    import('@fontsource-variable/noto-sans-sc/wght.css').catch(() => {})
    import('@fontsource-variable/noto-serif-sc/wght.css').catch(() => {})
}
// A slow outside script can hold up 'load', so start after a few seconds anyway (a second import is a no-op).
if (document.readyState === 'complete') loadChineseFonts()
else {
    window.addEventListener('load', loadChineseFonts, { once: true })
    setTimeout(loadChineseFonts, 4000)
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <KebiaoMotionProvider>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </KebiaoMotionProvider>
    </React.StrictMode>,
)
