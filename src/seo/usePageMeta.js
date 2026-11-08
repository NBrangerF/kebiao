import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { DEFAULT_PAGE_META, SITE_URL } from './pageMeta.js'
import { getPrerenderSnapshot } from './prerenderSnapshot.js'

function setMeta(selector, attribute, value) {
    const element = document.head.querySelector(selector)
    if (element) element.setAttribute(attribute, value)
}

function applyPageMeta({ title, description, path }) {
    document.title = title
    setMeta('meta[name="description"]', 'content', description)
    setMeta('meta[property="og:title"]', 'content', title)
    setMeta('meta[property="og:description"]', 'content', description)
    const url = `${SITE_URL}${path}`
    setMeta('link[rel="canonical"]', 'href', url)
    setMeta('meta[property="og:url"]', 'content', url)
}

/**
 * Keeps the tab title, description and canonical URL in step with in-app navigation.
 * WeChat uses document.title when a page is shared from its browser.
 * Pass null while the page's data is still loading.
 */
export function usePageMeta(meta) {
    const { pathname } = useLocation()
    const { title, description, path } = meta || {}
    useEffect(() => {
        if (title) applyPageMeta({ title, description, path: path || pathname })
    }, [title, description, path, pathname])
}

// Resets to the site defaults on every route change; pages without usePageMeta keep these.
// Render it before <Routes> so page effects run after it.
// The page a visitor lands on keeps its prerendered head: a page whose data fails to load must not end up with the
// home page's title.
let landed = false
export function DefaultPageMeta() {
    const { pathname } = useLocation()
    useEffect(() => {
        const landing = !landed
        landed = true
        if (landing && getPrerenderSnapshot(pathname)) return
        applyPageMeta({ ...DEFAULT_PAGE_META, path: pathname })
    }, [pathname])
    return null
}
