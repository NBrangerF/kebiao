// The text of each 国家平台 lesson's own pages in the textbook PDF, for the AI 备课 prompts (server-side data, not public).
// A lesson runs from its pdf_page to the page before the next lesson starts, at most 3 pages; the text is the PDF's own
// text layer (scanned pages have none), CJK spacing removed, cut at 1,800 characters.
//   node scripts/resources/extract_lesson_text.mjs [library root] [edition_id …]
// Reads data/textbooks/library-state (the generation production serves, so page numbers match the reader) and
// public/data/textbooks/national-lessons; writes data/textbooks/lesson-text/<edition>.json.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const [root = '/Volumes/X9 Pro/kebiao-library', ...only] = process.argv.slice(2)
const MAX_PAGES = 3
const MAX_CHARS = 1800
const current = JSON.parse(await readFile('data/textbooks/library-state/CURRENT.json', 'utf8'))
const registry = (await readFile(`data/textbooks/library-state/generations/${current.generation_id}/asset_registry.lock.jsonl`, 'utf8'))
    .split('\n').filter(Boolean).map(line => JSON.parse(line))
const assets = new Map()
for (const asset of registry) {
    if (asset.resource_type !== 'student_textbook' || !asset.object_path) continue
    if (!assets.has(asset.edition_id) || asset.current_confirmed) assets.set(asset.edition_id, asset)
}

const CJK = '\\u3000-\\u303f\\u3400-\\u9fff\\uff00-\\uffef'
const clean = text => text
    .replace(/[ \t]+/gu, ' ')
    .replace(new RegExp(`(?<=[${CJK}]) (?=[${CJK}])`, 'gu'), '')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{2,}/gu, '\n')
    .trim()

async function pageText(pdf, number) {
    const content = await (await pdf.getPage(number)).getTextContent()
    return clean(content.items.map(item => `${item.str}${item.hasEOL ? '\n' : ''}`).join(''))
}

// A platform lesson often has no pdf_page. Its start is then the book's own 目录 or outline entry with the same title,
// else the first page its 教材原话 quotes come from.
const contents = JSON.parse(await readFile('data/v2/textbook_contents.json', 'utf8'))
const plain = title => String(title || '')
    .replace(/[（(]第[一二三四五六七八九十\d]+课时[）)]/gu, '')
    .replace(/^[^_]{2,20}_/u, '')
    .replace(/^(?:第[一二三四五六七八九十百零\d]+(?:单元|章|节|课)|课题\s*\d+|\d+(?:\.\d+)*\*?)\s*/u, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase()
async function outline(edition) {
    const pages = new Map()
    for (const entry of contents[edition] || []) if (Number.isInteger(entry.pdf_page)) pages.set(plain(entry.title), entry.pdf_page)
    try {
        const record = JSON.parse(await readFile(`public/data/textbooks/by-edition/${edition}.json`, 'utf8'))
        for (const node of record.content_nodes || []) {
            if (['lesson', 'section', 'unit'].includes(node.kind) && Number.isInteger(node.pdf_page) && !pages.has(plain(node.title))) pages.set(plain(node.title), node.pdf_page)
        }
    } catch { /* no structure record */ }
    return pages
}
function startOf(lesson, pages) {
    if (Number.isInteger(lesson.pdf_page) && lesson.pdf_page > 0) return lesson.pdf_page
    const own = pages.get(plain(lesson.title))
    if (own) return own
    const quoted = (lesson.align || []).filter(row => row[3] === 'book' && Number.isInteger(row[4])).map(row => row[4])
    return quoted.length ? Math.min(...quoted) : null
}

await mkdir('data/textbooks/lesson-text', { recursive: true })
const files = (await readdir('public/data/textbooks/national-lessons')).filter(name => /^ed_[0-9a-f]+\.json$/u.test(name))
let books = 0
let lessons = 0
let empty = 0
for (const name of files) {
    const edition = name.replace(/\.json$/u, '')
    if (only.length && !only.includes(edition)) continue
    const asset = assets.get(edition)
    if (!asset) { console.log(`${edition}: no PDF in ${current.generation_id}`); continue }
    const national = JSON.parse(await readFile(join('public/data/textbooks/national-lessons', name), 'utf8'))
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await readFile(join(root, asset.object_path))), disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise
    const pages = await outline(edition)
    const startOfLesson = new Map(national.lessons.map(lesson => [lesson.id, startOf(lesson, pages)]))
    const starts = [...new Set([...startOfLesson.values(), ...pages.values()].filter(page => Number.isInteger(page) && page > 0))].sort((a, b) => a - b)
    const cache = new Map()
    const text = async number => {
        if (!cache.has(number)) cache.set(number, number <= pdf.numPages ? await pageText(pdf, number) : '')
        return cache.get(number)
    }
    const out = { edition_id: edition, generation_id: current.generation_id, source: 'pdfjs_text_layer', lessons: {} }
    for (const lesson of national.lessons) {
        const from = startOfLesson.get(lesson.id)
        if (!Number.isInteger(from) || from < 1 || from > pdf.numPages) continue
        const next = starts.find(page => page > from)
        const to = Math.min(from + MAX_PAGES - 1, next ? Math.max(from, next - 1) : from + MAX_PAGES - 1, pdf.numPages)
        const parts = []
        for (let page = from; page <= to; page += 1) parts.push(await text(page))
        const joined = parts.filter(Boolean).join('\n').slice(0, MAX_CHARS)
        if (!joined) { empty += 1; continue }
        out.lessons[lesson.id] = { from, to, text: joined }
        lessons += 1
    }
    await pdf.destroy()
    await writeFile(join('data/textbooks/lesson-text', name), `${JSON.stringify(out)}\n`)
    books += 1
    console.log(`${edition} ${national.platform_title || ''}: ${Object.keys(out.lessons).length}/${national.lessons.length} lessons`)
}
console.log(`done: ${books} books, ${lessons} lessons with text, ${empty} without`)
