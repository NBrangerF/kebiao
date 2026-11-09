// How often a lesson's extracted textbook text (data/textbooks/lesson-text) is the lesson's own: its title is on those pages,
// and for an English lesson with a unit number, the pages sit inside that unit. Reports the miss rate per start-page source
// and per subject. Given two folders (before, after), it compares them on the lessons both have text for.
//   node scripts/resources/check_lesson_text.mjs [lesson-text dir] [after dir] [--misses N] [--subject 英语]
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { titleKeys, titleOnPage } from './lesson_title.mjs'

const args = process.argv.slice(2)
const option = name => { const at = args.indexOf(name); return at >= 0 ? args.splice(at, 2)[1] : null }
const showMisses = Number(option('--misses') || 0)
const onlySubject = option('--subject')
const dirs = args.length ? args : ['data/textbooks/lesson-text']

// a book's English units: number → [first page, last page], from its verified 目录
async function englishUnits(edition) {
    const units = new Map()
    try {
        const record = JSON.parse(await readFile(`public/data/textbooks/by-edition/${edition}.json`, 'utf8'))
        // the verified 目录's units first: an appendix's "Unit 2" heading is not the unit
        const nodes = (record.content_nodes || []).filter(node => node.kind === 'unit').sort((a, b) => (b.source === 'verified_toc') - (a.source === 'verified_toc'))
        for (const node of nodes) {
            const match = String(node.title).match(/^\s*(unit|module)\s*(\d+)/iu)
            const key = match && `${match[1].toLowerCase()} ${Number(match[2])}`
            if (key && !units.has(key) && Number.isInteger(node.pdf_page) && Number.isInteger(node.end_pdf_page)) units.set(key, [node.pdf_page, node.end_pdf_page])
        }
    } catch { /* no structure record */ }
    return units
}

// per lesson: its groups, and per folder whether its text is its own (undefined: no text there)
const rows = []
const misses = []
let noTitle = 0
for (const name of (await readdir('public/data/textbooks/national-lessons')).filter(file => /^ed_[0-9a-f]+\.json$/u.test(file))) {
    const edition = name.replace(/\.json$/u, '')
    const national = JSON.parse(await readFile(join('public/data/textbooks/national-lessons', name), 'utf8'))
    let subject = '?'
    try { subject = JSON.parse(await readFile(`public/data/textbooks/by-edition/${edition}.json`, 'utf8')).subject } catch { /* unknown */ }
    if (onlySubject && subject !== onlySubject) continue
    const files = []
    for (const dir of dirs) { try { files.push(JSON.parse(await readFile(join(dir, name), 'utf8'))) } catch { files.push(null) } }
    const units = subject === '英语' ? await englishUnits(edition) : new Map()
    for (const lesson of national.lessons) {
        const keys = titleKeys(lesson.title, subject)
        if (titleOnPage(keys, '') === null) { noTitle += 1; continue }
        const range = keys.kind === 'en' && keys.unit ? units.get(`${keys.unit.word} ${keys.unit.n}`) : null
        const hits = files.map((file, at) => {
            const entry = file?.lessons?.[lesson.id]
            if (!entry) return undefined
            let hit = titleOnPage(keys, entry.text) || (keys.section ? titleOnPage({ kind: 'en', ...keys.section }, entry.text) : false)
            if (hit && range && (entry.from < range[0] || entry.from > range[1])) hit = false
            if (!hit && at === files.length - 1) misses.push(`${subject} ${edition} ${national.textbook_title} 「${lesson.title}」 p${entry.from}-${entry.to} [${entry.via || '?'}] ${entry.text.slice(0, 60).replace(/\n/gu, '|')}`)
            return hit
        })
        const entry = files.at(-1)?.lessons?.[lesson.id]
        const hasPage = Number.isInteger(lesson.pdf_page) && lesson.pdf_page > 0 ? 'lesson  has pdf_page' : 'lesson  no pdf_page'
        rows.push({ groups: [subject === '英语' ? 'all     英语' : 'all     non-English', `subject ${subject}`, hasPage, ...(entry?.via ? [`via     ${entry.via}`] : [])], hits })
    }
}

const pad = (text, width) => text + ' '.repeat(Math.max(0, width - [...text].reduce((sum, char) => sum + (/[^\x00-\x7f]/u.test(char) ? 2 : 1), 0)))
const rate = (miss, n) => `${String(miss).padStart(5)} / ${String(n).padStart(5)} ${n ? (100 * miss / n).toFixed(1).padStart(5) : '    -'}%`
const shared = rows.filter(row => row.hits.every(hit => hit !== undefined))
console.log(dirs.length > 1 ? `miss rate on the ${shared.length} lessons with text in all of: ${dirs.join(' | ')}` : `miss rate in ${dirs[0]}`)
for (const group of [...new Set(rows.flatMap(row => row.groups))].sort()) {
    const inGroup = shared.filter(row => row.groups.includes(group))
    if (inGroup.length) console.log(`${pad(group, 26)} ${dirs.map((_, at) => rate(inGroup.filter(row => !row.hits[at]).length, inGroup.length)).join('   →  ')}`)
}
dirs.forEach((dir, at) => {
    const own = rows.filter(row => row.hits[at] !== undefined)
    const nonEnglish = own.filter(row => !row.groups.includes('all     英语'))
    console.log(`${dir}: ${own.length} lessons with text, ${own.filter(row => !row.hits[at]).length} miss (non-English ${nonEnglish.filter(row => !row.hits[at]).length} / ${nonEnglish.length}); ${rows.length - own.length} without text`)
})
console.log(`titles with nothing to match: ${noTitle}`)
if (showMisses) for (const line of misses.sort(() => 0.5 - Math.random()).slice(0, showMisses)) console.log(line)
