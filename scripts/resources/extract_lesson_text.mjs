// The text of each 国家平台 lesson's own pages in the textbook PDF, for the AI 备课 prompts (server-side data, not public).
// Which pages are a lesson's own is lesson_pages.mjs's job (at most 3); the text is the PDF's own text layer (a scanned
// page: its OCR text from the page sidecar), CJK spacing removed, cut at 1,800 characters.
//   node scripts/resources/extract_lesson_text.mjs [library root] [edition_id …]
// Reads data/textbooks/library-state (the generation production serves, so page numbers match the reader) and
// public/data/textbooks/national-lessons; writes data/textbooks/lesson-text/<edition>.json.
// Check the result with scripts/resources/check_lesson_text.mjs.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { bookOutline, lessonPages } from './lesson_pages.mjs'

const [root = '/Volumes/X9 Pro/kebiao-library', ...only] = process.argv.slice(2)
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

const contents = JSON.parse(await readFile('data/v2/textbook_contents.json', 'utf8'))
const checked = JSON.parse(await readFile('data/textbooks/lesson-pages-checked.json', 'utf8'))

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
    // a scanned page has no text layer: its OCR text from the page sidecar (Vision or Tesseract), when there is one
    const ocr = new Map()
    try {
        for (const line of (await readFile(join(root, 'derived/textbook-content-v2', asset.sha256, 'pages.jsonl'), 'utf8')).split('\n').filter(Boolean)) {
            const page = JSON.parse(line)
            if (/vision|tesseract/u.test(page.extraction_method || '') && page.text) ocr.set(page.pdf_page, clean(page.text))
        }
    } catch { /* no sidecar */ }
    let usedOcr = false
    const pages = [''] // pages[1..numPages]: every page's text, for finding where each lesson starts
    for (let number = 1; number <= pdf.numPages; number += 1) {
        let value = await pageText(pdf, number)
        if (value.replace(/\s/gu, '').length < 20 && ocr.get(number)) { value = ocr.get(number); usedOcr = true }
        pages.push(value)
    }
    let subject = null
    try { subject = JSON.parse(await readFile(`public/data/textbooks/by-edition/${edition}.json`, 'utf8')).subject } catch { /* no structure record */ }
    const outline = await bookOutline(edition, contents, pdf.numPages)
    const located = lessonPages({ lessons: national.lessons, subject, pages, outline, checked: checked[edition] || {} })
    const out = { edition_id: edition, generation_id: current.generation_id, source: 'pdfjs_text_layer', lessons: {} }
    for (const lesson of national.lessons) {
        const at = located.get(lesson.id)
        if (!at) continue
        const joined = pages.slice(at.from, at.to + 1).filter(Boolean).join('\n').slice(0, MAX_CHARS)
        if (!joined) { empty += 1; continue }
        out.lessons[lesson.id] = { from: at.from, to: at.to, via: at.via, text: joined }
        lessons += 1
    }
    await pdf.destroy()
    if (usedOcr) out.source = 'pdfjs_text_layer+ocr'
    await writeFile(join('data/textbooks/lesson-text', name), `${JSON.stringify(out)}\n`)
    books += 1
    console.log(`${edition} ${national.platform_title || ''}: ${Object.keys(out.lessons).length}/${national.lessons.length} lessons`)
}
console.log(`done: ${books} books, ${lessons} lessons with text, ${empty} without`)
