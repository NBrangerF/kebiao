#!/usr/bin/env node
// Reads each 高中课标 PDF's positioned text lines and writes one clean reading copy of its 课程内容 chapter:
// generated/senior/pages/<key>.json  [{ pdf, printed, text }]  and  <key>.txt  (the same, for reading).
// Running heads and page numbers are removed; a table page is read column by column.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDF_DIR, SOURCES, keyOf } from './sources.mjs'

const OUT = 'generated/senior'
mkdirSync(join(OUT, 'pages'), { recursive: true })
mkdirSync(join(OUT, 'lines'), { recursive: true })
const TOOL = join(OUT, 'pdf_lines')
if (!existsSync(TOOL)) execFileSync('swiftc', ['-O', 'scripts/senior/pdf_lines.swift', '-o', TOOL], { stdio: 'inherit' })
// the typesetting font's private glyphs: math-italic Latin letters sit on rare CJK code points, 槡 is the radical sign
const LOWER = '犪犫犮犱犲犳犵犺犻犼犽犾犿狀狅狆狇狉狊狋狌狏狑狓狔狕'
const UPPER = '犃犅犆犇犈犉犌犎犐犑犓犔犕犖犗犘犙犚犛犜犝犞犠犡犢犣'
const GLYPH = new Map([['', '.'], ['', '-'], ['', '*'], ['', ''], ['槡', '√']])
for (const [index, ch] of [...LOWER].entries()) GLYPH.set(ch, String.fromCharCode(97 + index))
for (const [index, ch] of [...UPPER].entries()) GLYPH.set(ch, String.fromCharCode(65 + index))
const clean = text => [...text].map(ch => (GLYPH.has(ch) ? GLYPH.get(ch) : ch)).join('')
const isNumber = text => /^[\d０-９]+$/u.test(text)
const digits = text => Number(text.normalize('NFKC'))

// 思想政治's 内容要求 | 教学提示 tables: the right column starts 93 pt left of its centred 教学提示 header, on every page
function readingOrder(lines, width, headedTable = false) {
    const header = headedTable && lines.some(line => line[4] === '内容要求') ? lines.find(line => line[4] === '教学提示') : null
    if (header) {
        const split = header[0] - 95
        const column = keep => lines.filter(keep).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(line => line[4])
        return ['〔左栏〕', ...column(line => line[0] < split), '〔右栏〕', ...column(line => line[0] >= split)]
    }
    const rows = new Map()
    for (const line of lines) {
        const key = Math.round(line[1] / 4)
        rows.set(key, [...(rows.get(key) || []), line])
    }
    const pairs = [...rows.values()].filter(row => row.length >= 2).map(row => row.sort((a, b) => a[0] - b[0]))
    const splits = pairs.map(row => row[1][0]).filter(x => x > width * 0.3 && x < width * 0.7)
    if (splits.length < 4) return [...lines].sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(line => line[4])
    const counts = new Map()
    for (const x of splits) counts.set(x, (counts.get(x) || 0) + 1)
    const split = [...counts].sort((a, b) => b[1] - a[1])[0][0] - 2
    const left = lines.filter(line => line[0] < split).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(line => line[4])
    const right = lines.filter(line => line[0] >= split).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(line => line[4])
    return ['〔左栏〕', ...left, '〔右栏〕', ...right]
}

// 通用技术 has no tables in this chapter; the side-by-side labels of its one diagram are not columns
const summary = []
const only = process.argv[2]
for (const source of SOURCES.filter(item => !only || item.key === only)) {
    const pdf = readdirSync(PDF_DIR).find(name => name.startsWith(`${source.no}.`))
    const json = join(OUT, 'lines', `${source.key}.json`)
    if (!existsSync(json)) execFileSync(TOOL, [join(PDF_DIR, pdf), json], { stdio: ['ignore', 'ignore', 'ignore'] })
    const pages = JSON.parse(readFileSync(json, 'utf8'))
    const has = (page, pattern) => page.lines.some(line => pattern.test(keyOf(line[4])))
    // 数学 prints its chapter heads as art, so its chapter is found by the first section inside and the next chapter's first
    const start = pages.findIndex((page, index) => index > 8 && has(page, source.key === 'math' ? /^\(一\)必修课程$/u : /^四[、.]?课程内容$/u))
    const endAt = pages.findIndex((page, index) => index > start && has(page, source.key === 'math' ? /^\(一\)学业质量内涵$/u : /^五[、.]?学业质量$/u))
    if (start < 0 || endAt < 0) throw new Error(`${source.key}: 课程内容 not found (${start}, ${endAt})`)
    const out = []
    for (const page of pages.slice(start, endAt + 1)) {
        const foot = page.lines.filter(line => line[1] > page.h - 90 && isNumber(line[4])).at(-1)
        const body = page.lines.filter(line => line !== foot && line[1] > 62 && !/^│.*│$/u.test(line[4]) && line[4] !== '续表'
            // a footnote at the foot of the page would otherwise land inside a sentence that runs on to the next page
            && !(line[1] > page.h * 0.72 && /^[［\[]\s*[\d１-９]\s*[］\]]/u.test(line[4])))
        // 数学's foot lines also hold formula digits, so its printed page comes from the book's fixed offset (目录: 必修 13 = PDF 21)
        out.push({ pdf: page.page, printed: source.key === 'math' ? page.page - 8 : foot ? digits(foot[4]) : null, text: clean((source.key === 'technology' ? [...body].sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(line => line[4]) : readingOrder(body, page.w, source.key === 'politics')).join('\n')) })
    }
    writeFileSync(join(OUT, 'pages', `${source.key}.json`), JSON.stringify(out))
    writeFileSync(join(OUT, 'pages', `${source.key}.txt`), out.map(page => `[[第 ${page.printed ?? '?'} 页 · PDF ${page.pdf}]]\n${page.text}`).join('\n\n'))
    summary.push(`${source.name} p${out[0].pdf}-${out.at(-1).pdf} ${out.reduce((sum, page) => sum + page.text.length, 0)} 字`)
}
console.log(summary.join('\n'))
