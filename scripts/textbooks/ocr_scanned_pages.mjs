// Textbooks whose PDF has no text layer (most 北师大版 and 外研社版 books from the 国家平台 reader are page images):
// reads every page with Apple Vision OCR (vision_ocr_lines.swift, far faster and better at Chinese than Tesseract)
// into the page sidecar <library>/derived/textbook-content-v2/<sha256>/pages.jsonl, lines with pixel boxes like
// Tesseract's. build_textbook_content_alignments.js --ocr auto then reuses these pages instead of running Tesseract,
// and everything that reads page text (printed 目录, 同步课 matching, lesson evidence) gets the book's words.
//   node scripts/textbooks/ocr_scanned_pages.mjs --edition ed_… [--edition ed_…] [--dpi 150] [--force]
// Needs pdftoppm (codex override bin on PATH), swiftc and the textbook drive. A book whose sidecar already has OCR
// lines on every page is skipped unless --force.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argv = process.argv.slice(2)
const value = name => argv[argv.indexOf(name) + 1]
const LIBRARY = argv.includes('--library-root') ? value('--library-root') : process.env.TEXTBOOK_LIBRARY_ROOT || '/Volumes/X9 Pro/kebiao-library'
const DPI = argv.includes('--dpi') ? Number(value('--dpi')) : 150
const CHUNK = 12
const editions = argv.flatMap((item, index) => (item === '--edition' ? [argv[index + 1]] : []))
if (!editions.length) throw new Error('name the books: --edition ed_…')

const BIN = path.join(ROOT, 'generated/smartedu/vision_ocr_lines')
if (!existsSync(BIN)) {
    mkdirSync(path.dirname(BIN), { recursive: true })
    execFileSync('swiftc', ['-O', path.join(ROOT, 'scripts/textbooks/vision_ocr_lines.swift'), '-o', BIN])
}
const current = JSON.parse(readFileSync(path.join(ROOT, 'data/textbooks/library-state/CURRENT.json'), 'utf8')).generation_id
const registry = readFileSync(path.join(ROOT, 'data/textbooks/library-state/generations', current, 'asset_registry.lock.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(line => JSON.parse(line))

for (const edition of editions) {
    const asset = registry.find(row => row.edition_id === edition && row.resource_type === 'student_textbook')
    if (!asset) { console.log(`${edition}: not in the current registry`); continue }
    const pdf = path.join(LIBRARY, asset.object_path)
    const directory = path.join(LIBRARY, 'derived/textbook-content-v2', asset.sha256)
    const sidecar = path.join(directory, 'pages.jsonl')
    if (!argv.includes('--force') && existsSync(sidecar)) {
        const pages = readFileSync(sidecar, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
        if (pages.length === asset.pages && pages.every(page => /vision|tesseract/u.test(page.extraction_method || '') || String(page.text || '').replace(/\s/gu, '').length >= 20)) {
            console.log(`${edition}: sidecar already has text on every page`)
            continue
        }
    }
    mkdirSync(directory, { recursive: true })
    const work = mkdtempSync(path.join(LIBRARY, 'staging/tmp/vision-'))
    const rows = []
    const started = Date.now()
    try {
        for (let first = 1; first <= asset.pages; first += CHUNK) {
            const last = Math.min(asset.pages, first + CHUNK - 1)
            execFileSync('pdftoppm', ['-f', String(first), '-l', String(last), '-r', String(DPI), '-png', pdf, path.join(work, 'p')], { stdio: 'pipe' })
            const images = []
            for (let page = first; page <= last; page += 1) {
                const name = [3, 2, 1].map(width => path.join(work, `p-${String(page).padStart(width, '0')}.png`)).find(file => existsSync(file))
                if (name) images.push([page, name])
            }
            const out = execFileSync(BIN, images.map(([, file]) => file), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
            const byFile = new Map(out.split('\n').filter(Boolean).map(line => JSON.parse(line)).map(row => [row.file, row]))
            for (const [page, file] of images) {
                const result = byFile.get(file) || { width: 0, height: 0, lines: [] }
                const lines = result.lines.map(line => ({ text: line.text, bbox: { x: line.x, y: line.y, width: line.w, height: line.h, unit: 'pixel', page_width: result.width, page_height: result.height } }))
                rows.push({
                    schema_version: 2,
                    edition_id: edition,
                    asset_sha256: asset.sha256,
                    pdf_page: page,
                    printed_page: null,
                    page_width: result.width,
                    page_height: result.height,
                    extraction_method: 'pdftoppm_vision_ocr',
                    extraction_status: lines.length ? 'ocr_extracted' : 'ocr_empty',
                    text: lines.map(line => line.text).join('\n'),
                    lines
                })
                rmSync(file, { force: true })
            }
        }
    } finally {
        rmSync(work, { recursive: true, force: true })
    }
    const temporary = `${sidecar}.tmp-${process.pid}`
    writeFileSync(temporary, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`)
    renameSync(temporary, sidecar)
    console.log(`${edition}: ${rows.length} pages, ${rows.filter(row => row.lines.length).length} with text, ${Math.round((Date.now() - started) / 1000)} s`)
}
