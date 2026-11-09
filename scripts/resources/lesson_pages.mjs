// Which pages of the textbook PDF are a lesson's own, for extract_lesson_text.mjs.
// A start page is taken from the lesson's pdf_page, else the book's 目录/outline entry with the same title, else the
// lowest page its 教材原话 quotes come from, but only when the lesson's title is on that page and the page sits in the
// lesson's unit. Otherwise the start is the page in the unit that carries the title (near the top, for a Chinese
// heading). English lessons are found inside their unit: Part A's activity is the first page with it, Part B's the last.
// A page outside the lesson's unit is used only when the title is on it; else the lesson gets no text. A few start pages
// are set by hand (data/textbooks/lesson-pages-checked.json). A lesson ends before the next lesson's, unit's or printed
// 目录 entry's start, at most MAX_PAGES pages.
import { readFile } from 'node:fs/promises'
import { titleKeys, titleOnPage, titleAt } from './lesson_title.mjs'

export const MAX_PAGES = 3
const HEADING = 40 // a title within the first 40 characters of a page is its heading

export const plain = title => String(title || '')
    .replace(/[（(]第[一二三四五六七八九十\d]+课时[）)]/gu, '')
    .replace(/^[^_]{2,20}_/u, '')
    .replace(/^(?:第[一二三四五六七八九十百零\d]+(?:单元|章|节|课)|课题\s*\d+|\d+(?:\.\d+)*\*?)\s*/u, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase()

// "Unit 3", "Module 2", "Starter Unit 1" in a title, as one key
export const unitKey = title => {
    const match = String(title || '').replace(/_/gu, ' ').match(/\b(starter\s+)?(unit|module)\s*(\d+)\b/iu)
    return match ? `${match[1] ? 'starter ' : ''}${match[2].toLowerCase()} ${Number(match[3])}` : null
}

// The book's outline: title → start page, its units with page ranges, and the pages a lesson cannot run past
export async function bookOutline(edition, contents, pageCount) {
    const titles = new Map() // title → its pages: "小结" ends every chapter
    const addTitle = (title, page) => { const key = plain(title); if (!titles.has(key)) titles.set(key, []); if (!titles.get(key).includes(page)) titles.get(key).push(page) }
    const units = []
    const marks = new Set()
    const printed = contents[edition] || []
    printed.forEach((entry, at) => {
        if (!Number.isInteger(entry.pdf_page)) return
        addTitle(entry.title, entry.pdf_page)
        marks.add(entry.pdf_page)
        if (entry.level === 1) {
            const next = printed.slice(at + 1).find(other => other.level === 1 && Number.isInteger(other.pdf_page))
            units.push({ title: `${entry.label || ''} ${entry.title}`, from: entry.pdf_page, to: next ? next.pdf_page - 1 : pageCount, trusted: true })
        }
    })
    try {
        const record = JSON.parse(await readFile(`public/data/textbooks/by-edition/${edition}.json`, 'utf8'))
        for (const node of record.content_nodes || []) {
            if (!['lesson', 'section', 'unit'].includes(node.kind) || !Number.isInteger(node.pdf_page)) continue
            addTitle(node.title, node.pdf_page)
            // a body heading may be a stray line of text: a lesson may run past it
            if (node.source === 'verified_toc' || node.kind === 'unit') marks.add(node.pdf_page)
            if (node.kind === 'unit') units.push({ title: node.title, from: node.pdf_page, to: Number.isInteger(node.end_pdf_page) ? node.end_pdf_page : node.pdf_page, trusted: node.source === 'verified_toc' })
        }
    } catch { /* no structure record */ }
    return { titles, units, marks }
}

// the lesson's unit: by "Unit 3" for English, else by its first chapter's title
function unitOf(lesson, keys, units) {
    const pick = found => found.sort((a, b) => (b.trusted - a.trusted) || ((b.to - b.from) - (a.to - a.from)))[0] || null
    if (keys.kind === 'en') {
        const key = unitKey(lesson.title)
        return key ? pick(units.filter(unit => unitKey(unit.title) === key)) : null
    }
    const chapter = plain(lesson.chapters?.[0])
    const label = unitLabel(lesson.chapters?.[0])
    return pick(units.filter(unit => {
        // 「第三单元·阅读」 is not 「第一单元·阅读」: numbered units match by number
        const own = unitLabel(unit.title)
        if (label && own) return label === own
        const name = plain(unit.title)
        return chapter.length >= 2 && name.length >= 2 && (name === chapter || (name.length >= 4 && chapter.includes(name)) || (chapter.length >= 4 && name.includes(chapter)))
    }))
}
// 「第三单元」, 「第3章」, 「三、」 or 「3 」 at the start of a unit's title, as one key
const DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const number = text => /^\d+$/u.test(text) ? Number(text) : [...text].reduce((sum, char, at) => char === '十' ? (at === 0 ? 10 : sum * 10) : sum + (DIGITS[char] || 0), 0)
function unitLabel(title) {
    const text = String(title || '').trim()
    const named = text.match(/^第\s*([一二三四五六七八九十\d]+)\s*(单元|章)/u)
    if (named) return `${number(named[1])}${named[2]}`
    const counted = text.match(/^([一二三四五六七八九十]+)[、.．]|^(\d+)(?:\s+|[、.．](?!\d))/u)
    return counted ? `${number(counted[1] || counted[2])}` : null
}

const range = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, at) => from + at)

// checked: lesson id → its first page, read by hand where the rules cannot tell (data/textbooks/lesson-pages-checked.json)
export function lessonPages({ lessons, subject, pages, outline, checked = {} }) {
    const count = pages.length - 1 // pages[1..count]
    // the first page of the book's body: no lesson starts in the front matter
    const known = [...outline.units.map(unit => unit.from), ...outline.marks, ...lessons.map(lesson => lesson.pdf_page)].filter(page => Number.isInteger(page) && page >= 1)
    const bodyStart = known.length ? Math.min(...known) : 1
    const keyed = lessons.map(lesson => ({ lesson, keys: titleKeys(lesson.title, subject) }))
    // a 目录 or unit-opening page names many lessons; it is never a lesson's first page
    const listing = new Set()
    const chinese = [...new Map(keyed.filter(({ keys }) => keys.kind === 'zh' && keys.tokens.length).map(({ keys }) => [keys.core, keys])).values()]
    if (chinese.length >= 6) {
        for (let page = 1; page <= count; page += 1) {
            if (chinese.filter(keys => titleOnPage(keys, pages[page])).length >= 4) listing.add(page)
        }
    }
    // a chapter the outline does not have: from its printed heading, kept only when the chapters run in the book's order
    const units = [...outline.units]
    const derived = []
    for (const chapter of new Set(lessons.map(lesson => lesson.chapters?.[0]).filter(Boolean))) {
        const keys = titleKeys(chapter, subject)
        if (keys.kind !== 'zh' || keys.core.length < 2 || unitOf({ chapters: [chapter] }, keys, outline.units)) continue
        const page = range(bodyStart, count).find(page => { if (listing.has(page)) return false; const at = titleAt(keys, pages[page]); return at >= 0 && at < HEADING })
        if (page) derived.push({ title: chapter, from: page })
    }
    if (derived.length >= 2 && derived.every((unit, at) => at === 0 || unit.from > derived[at - 1].from)) {
        const starts = [...derived.map(unit => unit.from), ...outline.units.map(unit => unit.from)]
        for (const unit of derived) units.push({ ...unit, to: Math.min(count + 1, ...starts.filter(page => page > unit.from)) - 1, trusted: false })
    }
    const found = new Map()
    for (const { lesson, keys } of keyed) {
        const unit = unitOf(lesson, keys, units)
        const inUnit = page => !unit || (page >= unit.from && page <= unit.to)
        const candidates = []
        if (Number.isInteger(lesson.pdf_page) && lesson.pdf_page > 0 && lesson.pdf_page <= count) candidates.push([lesson.pdf_page, 'pdf_page'])
        const own = (outline.titles.get(plain(lesson.title)) || []).filter(page => page <= count)
        if (own.length) candidates.push([own.find(inUnit) || own[0], 'outline'])
        const quoted = (lesson.align || []).filter(row => row[3] === 'book' && Number.isInteger(row[4]) && row[4] <= count).map(row => row[4])
        if (quoted.length) candidates.push([Math.min(...quoted), 'quote'])

        const from = unit ? unit.from : bodyStart
        const to = unit ? Math.min(unit.to, count) : count
        const hits = []
        // a practice or review lesson's topic is on many pages: it is only checked on its own candidate pages
        for (let page = Math.max(1, from); page <= to && !keys.practice; page += 1) {
            if (listing.has(page)) continue
            const at = titleAt(keys, pages[page])
            if (at >= 0) hits.push({ page, heading: keys.kind === 'en' || at < HEADING })
        }
        let start = Number.isInteger(checked[lesson.id]?.from) ? [checked[lesson.id].from, 'checked'] : null
        if (start) { /* read by hand */ } else if (keys.kind === 'en') {
            const sectionAt = keys.section ? range(from, to).find(page => titleOnPage({ kind: 'en', ...keys.section }, pages[page])) : undefined
            // a whole unit or part as one lesson ("Unit 3 Time for school Part A"): from the unit's start
            const whole = unit && keys.words.length && keys.words.every(word => unit.title.toLowerCase().replace(/[’']/gu, '').includes(word))
            if (whole && keys.section) { if (sectionAt) start = [sectionAt, 'title'] }
            else if (whole) start = keys.part === 'B' || keys.part === 'C' ? [null, 'unit'] : [unit.from, 'unit']
            else if (hits.length) {
                // an activity of a named section: on or after the section's first page
                const after = sectionAt ? hits.filter(hit => hit.page >= sectionAt) : []
                const pool = after.length ? after : hits
                start = [(keys.part === 'B' || keys.part === 'C') ? pool.at(-1).page : pool[0].page, 'title']
            }
        } else {
            const verified = candidates.find(([page]) => inUnit(page) && !listing.has(page) && titleOnPage(keys, pages[page]))
            if (verified) start = verified
            else {
                const headings = hits.filter(hit => hit.heading)
                const near = list => {
                    const anchor = candidates.find(([page]) => inUnit(page))?.[0]
                    if (unit || !anchor) return list[0]
                    return [...list].sort((a, b) => Math.abs(a.page - anchor) - Math.abs(b.page - anchor))[0]
                }
                if (headings.length) start = [near(headings).page, 'title']
                else if (hits.length && unit) start = [hits[0].page, 'title']
            }
        }
        // a page outside the lesson's own unit only when its title is on it (an appendix word list); no text beats another unit's
        if (!start) start = candidates.find(([page]) => inUnit(page)) || candidates.find(([page]) => titleOnPage(keys, pages[page])) || null
        if (start) found.set(lesson.id, { from: start[0], via: start[1], unit, whole: start[1] === 'unit', part: keys.part })
    }
    // a whole Part B starts where the unit's first Part B activity does
    for (const [id, entry] of found) {
        if (entry.from !== null) continue
        const parts = [...found.values()].filter(other => other.unit === entry.unit && other.part === entry.part && other.via === 'title').map(other => other.from)
        if (parts.length) entry.from = Math.min(...parts)
        else found.delete(id)
    }
    // a lesson runs to the page before the next lesson, unit or 目录 entry starts, and stays inside its unit
    const starts = [...new Set([...[...found.values()].filter(entry => !entry.whole).map(entry => entry.from), ...outline.marks, ...units.map(unit => unit.from)])]
        .filter(page => Number.isInteger(page) && page > 0).sort((a, b) => a - b)
    const out = new Map()
    for (const [id, { from, via, unit, whole }] of found) {
        const next = whole ? null : starts.find(page => page > from)
        let to = Math.min(from + MAX_PAGES - 1, count)
        if (next) to = Math.min(to, next - 1)
        if (unit && from >= unit.from && from <= unit.to) to = Math.min(to, unit.to)
        out.set(id, { from, to: Math.max(from, to), via })
    }
    return out
}
