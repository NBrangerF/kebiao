#!/usr/bin/env node
// Checks a subject's structured 高中课标 against its PDF text and writes the canonical file.
// Usage: node scripts/senior/verify_senior.mjs <key> [--write]
// Reads  generated/senior/raw/<key>.json (agent's structure) + generated/senior/pages/<key>.json
// Writes data/v2/senior/<key>.json with text taken from the PDF itself (never the copy), and its printed pages.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { SOURCES } from './sources.mjs'

const [key, flag] = process.argv.slice(2)
const source = SOURCES.find(item => item.key === key)
if (!source) throw new Error(`unknown key ${key}`)
const pages = JSON.parse(readFileSync(`generated/senior/pages/${key}.json`, 'utf8'))
const raw = JSON.parse(readFileSync(`generated/senior/raw/${key}.json`, 'utf8'))
const TRACKS = ['必修', '选择性必修', '选修']

// the whole chapter as one string of match characters, each remembering its original character and page
const chars = []
let sourceIndex = 0
for (const page of pages) {
    for (const ch of page.text) {
        sourceIndex += 1
        for (const k of ch.normalize('NFKC').replace(/\s+/gu, '')) chars.push({ k, ch, id: sourceIndex, page: page.printed ?? page.pdf - 8 })
    }
}
const hay = chars.map(item => item.k).join('')
const fold = text => String(text).normalize('NFKC').replace(/\s+/gu, '')
const display = span => {
    let out = ''
    let last = null
    for (const item of span) {
        // one source character can fold to several match characters (…); write it once
        if (item.id === last) continue
        last = item.id
        const plain = /[０-９Ａ-Ｚａ-ｚ]/u.test(item.ch) ? item.ch.normalize('NFKC') : item.ch
        if (!/\s/u.test(plain)) out += plain
    }
    return out
}
const cjkOnly = text => [...text].filter(ch => /\p{Script=Han}/u.test(ch)).join('')
const hayCjk = []
chars.forEach((item, index) => { if (/\p{Script=Han}/u.test(item.k)) hayCjk.push(index) })
const hayCjkText = hayCjk.map(index => chars[index].k).join('')

// 英语's tables print row labels vertically, one character per line, so the text layer drops them inside a sentence.
// Only these label characters may be stepped over, and every character of the item must still be there in order.
const LABELS = new Set('必修选择性理解表达元认知策略情感交际语音词汇语法语篇用文化技能言知识类别内容要求主题境型学习提高()〔〕左右栏')
function matchOverLabels(needle) {
    if (key !== 'english' || needle.length < 6) return null
    const head = needle.slice(0, 4)
    for (let start = hay.indexOf(head); start >= 0; start = hay.indexOf(head, start + 1)) {
        const dead = new Set()
        const walk = (i, j, skipped, taken) => {
            if (j === needle.length) return taken
            if (i >= hay.length || skipped > 24 || dead.has(`${i}|${j}|${skipped}`)) return null
            if (hay[i] === needle[j]) {
                const hit = walk(i + 1, j + 1, skipped, [...taken, i])
                if (hit) return hit
            }
            if (LABELS.has(hay[i])) {
                const hit = walk(i + 1, j, skipped + 1, taken)
                if (hit) return hit
            }
            dead.add(`${i}|${j}|${skipped}`)
            return null
        }
        const found = walk(start, 0, 0, [])
        if (found) return found
    }
    return null
}

const errors = []
const notes = []
let cursor = 0
const out = []
let count = 0
for (const [si, standard] of raw.standards.entries()) {
    if (!TRACKS.includes(standard.track)) errors.push(`#${si} track「${standard.track}」`)
    for (const field of ['module', 'name', 'lane']) if (!standard[field]) errors.push(`#${si} 缺 ${field}`)
    if (!standard.points?.length) errors.push(`#${si}「${standard.name}」没有要点`)
    const points = []
    for (const point of standard.points || []) {
        count += 1
        const needle = fold(point.text)
        let at = needle ? hay.indexOf(needle, cursor) : -1
        if (at < 0 && needle) at = hay.indexOf(needle)
        if (at >= 0) {
            const span = chars.slice(at, at + needle.length)
            if (at < cursor) notes.push(`次序靠前：${point.no || ''} ${point.text.slice(0, 18)}`)
            cursor = at + needle.length
            points.push({ no: point.no || null, text: display(span), pages: [...new Set(span.map(item => item.page))] })
        } else if (matchOverLabels(needle)) {
            const span = matchOverLabels(needle).map(index => chars[index])
            notes.push(`跨表格标签拼接：${point.no || ''} ${point.text.slice(0, 24)}`)
            points.push({ no: point.no || null, text: display(span), pages: [...new Set(span.map(item => item.page))] })
        } else if (point.formula && !point.image_page) {
            // a formula was read from the page image: its Chinese must still be there, in order, and it is listed for review
            const han = cjkOnly(needle)
            const hit = han.length >= 4 ? hayCjkText.indexOf(han) : -1
            if (hit < 0) errors.push(`公式条的汉字对不上：${point.no || ''} ${point.text.slice(0, 30)}`)
            else {
                const from = hayCjk[hit]
                const to = hayCjk[hit + han.length - 1]
                points.push({ no: point.no || null, text: point.text.trim(), pages: [...new Set(chars.slice(from, to + 1).map(item => item.page))], formula: true })
                cursor = Math.max(cursor, to)
                notes.push(`公式条待看图：${point.no || ''} ${point.text.slice(0, 30)}`)
            }
        } else if (point.image_page) {
            // a table whose text layer is out of order, read from the page image: every character must be on that page
            const page = pages.find(item => item.pdf === point.image_page)
            const left = new Map()
            for (const ch of fold(page?.text || '')) left.set(ch, (left.get(ch) || 0) + 1)
            // a formula's symbols are not in the text layer, so only its Chinese is counted; `glyphs` names any character the font lost (祖暅)
            const wanted = [...needle].filter(ch => (!point.formula || /\p{Script=Han}/u.test(ch)) && !(point.glyphs || '').includes(ch))
            const missing = wanted.filter(ch => {
                left.set(ch, (left.get(ch) || 0) - 1)
                return left.get(ch) < 0
            })
            if (!page || missing.length) errors.push(`看图条的字不在 PDF ${point.image_page} 页：${point.text.slice(0, 24)}（${missing.join('')}）`)
            else {
                points.push({ no: point.no || null, text: point.text.trim(), pages: [page.printed ?? page.pdf - 8], from_image: true })
                notes.push(`看图转写，待人工核：${point.no || ''} ${point.text.slice(0, 24)}`)
            }
        } else errors.push(`原文里找不到：${point.no || ''} ${point.text.slice(0, 40)}`)
    }
    out.push({ track: standard.track, module: standard.module, theme: standard.theme || null, name: standard.name, lane: standard.lane, group: standard.group || null, points })
}
const seen = new Set()
for (const standard of out) for (const point of standard.points) {
    if (seen.has(point.text)) notes.push(`重复要点：${point.text.slice(0, 24)}`)
    seen.add(point.text)
}
const byTrack = TRACKS.map(track => `${track} ${out.filter(s => s.track === track).length} 标准/${out.filter(s => s.track === track).reduce((n, s) => n + s.points.length, 0)} 要点`).join('，')
console.log(`${source.name}: ${out.length} 标准, ${count} 要点（${byTrack}）; 错误 ${errors.length}, 提示 ${notes.length}`)
for (const line of errors.slice(0, 40)) console.log(`  ✗ ${line}`)
for (const line of notes.slice(0, 25)) console.log(`  · ${line}`)
if (flag === '--write' && !errors.length) {
    mkdirSync('data/v2/senior', { recursive: true })
    writeFileSync(`data/v2/senior/${key}.json`, `${JSON.stringify({ key, subject: source.name, graph: source.graph, source: `普通高中${source.name}课程标准（2017年版2020年修订）`, standards: out }, null, 1)}\n`)
    console.log(`  wrote data/v2/senior/${key}.json`)
}
process.exitCode = errors.length ? 1 : 0
