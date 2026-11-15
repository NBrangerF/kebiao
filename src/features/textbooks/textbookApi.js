const PUBLIC_ROOT = '/data/textbooks'

async function fetchJson(url, options) {
    const response = await fetch(url, options)
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
        const message = payload?.error?.message || `请求失败（${response.status}）`
        throw new Error(message)
    }
    return payload?.data ?? payload
}

// one request per visit: 教材馆, the book picker and 备课 share the catalog (a failed request is tried again next time)
let catalogRequest = null
let catalogValue = null
export function loadTextbookCatalog() {
    catalogRequest ||= fetchJson(`${PUBLIC_ROOT}/index.json`).then(
        value => (catalogValue = value),
        error => { catalogRequest = null; throw error }
    )
    return catalogRequest
}

/** The catalog if it has already arrived, so a page can show it without waiting. */
export const loadedTextbookCatalog = () => catalogValue

// the books whose lessons are matched to 课标 one by one (their 教材馆 cards say so), fetched once like the catalog
let alignedRequest = null
let alignedValue = null
export function loadAlignedEditions() {
    alignedRequest ||= fetch(`${PUBLIC_ROOT}/national-lessons/index.json`)
        .then(response => (response.ok ? response.json() : null))
        .then(data => (alignedValue = new Set(Object.keys(data?.editions || {}))), error => { alignedRequest = null; throw error })
    return alignedRequest
}

export const loadedAlignedEditions = () => alignedValue

export async function loadTextbookDetail(editionId) {
    if (!/^ed_[a-z0-9]+$/i.test(editionId)) throw new Error('教材编号无效。')
    return fetchJson(`${PUBLIC_ROOT}/by-edition/${editionId}.json`)
}

export async function createTextbookViewerSession(editionId) {
    return fetchJson(`/api/v1/textbooks/${editionId}/viewer-session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
    })
}

export async function loadTextbookResource(resourceId) {
    if (!/^res_[a-z0-9]+$/i.test(resourceId)) throw new Error('支持资源编号无效。')
    const catalog = await fetchJson(`${PUBLIC_ROOT}/resources/index.json`)
    const resource = (catalog.resources || []).find(item => item.resource_id === resourceId)
    if (!resource) throw new Error('未找到支持资源。')
    return resource
}

export async function createTextbookResourceViewerSession(resourceId) {
    if (!/^res_[a-z0-9]+$/i.test(resourceId)) throw new Error('支持资源编号无效。')
    return fetchJson(`/api/v1/textbook-resources/${encodeURIComponent(resourceId)}/viewer-session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
    })
}

export async function loadTextbookUnit(unitId) {
    if (!/^[a-z0-9_-]+$/i.test(unitId)) throw new Error('教材单元编号无效。')
    return fetchJson(`/api/v1/units/${encodeURIComponent(unitId)}`)
}

export async function loadTextbooksForStandard(standardCode) {
    return fetchJson(`/api/v1/standards/${encodeURIComponent(standardCode)}/textbooks`)
}

export function filterTextbooks(items, filters) {
    const query = filters.query.trim().toLocaleLowerCase('zh-CN')
    return items.filter(item => {
        if (filters.stage && item.stage !== filters.stage) return false
        if (filters.subject && item.subject_slug !== filters.subject) return false
        if (filters.grade && item.grade !== Number(filters.grade)) return false
        if (filters.volume && item.volume !== filters.volume) return false
        if (filters.edition && item.edition_name !== filters.edition) return false
        if (!query) return true
        return [item.title, item.subject, item.edition_name, item.grade_label, item.volume]
            .some(value => String(value).toLocaleLowerCase('zh-CN').includes(query))
    })
}
