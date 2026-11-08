import { copyToClipboard } from '../../data/query.js'

// Some in-app browsers (WeChat, QQ, older WebViews) refuse the clipboard. Then the page that listens for this event
// shows the text selected in a box, for a long-press copy.
export const COPY_FALLBACK_EVENT = 'kebiao:copy-fallback'

export async function copyText(text) {
    if (await copyToClipboard(text)) return true
    window.dispatchEvent(new CustomEvent(COPY_FALLBACK_EVENT, { detail: text }))
    return false
}
