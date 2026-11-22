#!/usr/bin/env node
// One reading packet per subject for judging 高中 「要先会」: its 高中 要点, the 初中 要点 they can build on, and the
// neighbouring subjects' 要点. Writes generated/senior/judge/<slug>.txt. Run after build_knowledge_graph.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const SLUGS = ['chinese', 'math', 'english', 'morality_law', 'history', 'geography', 'physics', 'chemistry', 'biology', 'it', 'technology', 'pe', 'arts']
const CROSS = { physics: ['math'], chemistry: ['math', 'physics'], biology: ['chemistry'], geography: ['math', 'physics'], it: ['math'], technology: ['math', 'physics', 'it'] }
const graphOf = slug => JSON.parse(readFileSync(`public/data/v2/graph/${slug}.json`, 'utf8'))
const senior = key => ['bx', 'xb', 'xx'].includes(key)
const juniorEnd = key => /^[6789]$|^7-9$|^6-7$|^8-9$|^shared$/u.test(key)
const label = (graph, key) => (key === 'shared' ? '七至九共同' : graph.columns.find(column => column.key === key)?.label || key)
const row = (graph, code) => {
    const point = graph.points[code]
    return `${code} | ${label(graph, point.col)} | ${graph.standards[point.std].title} | ${point.t}`
}
mkdirSync('generated/senior/judge', { recursive: true })
for (const slug of SLUGS) {
    const graph = graphOf(slug)
    const codes = Object.keys(graph.points)
    const parts = [`# 目标：${graph.subject} 高中要点（给这些要点找「要先会」，它们之间也可以互为来源）`, ...codes.filter(code => senior(graph.points[code].col)).map(code => row(graph, code))]
    const junior = codes.filter(code => juniorEnd(graph.points[code].col))
    if (junior.length) parts.push('', `# 来源：${graph.subject} 初中要点`, ...junior.map(code => row(graph, code)))
    for (const other of CROSS[slug] || []) {
        const cross = graphOf(other)
        // the neighbour's 初中 and 高中必修 are what a student has by then; its electives are not assumed
        const list = Object.keys(cross.points).filter(code => juniorEnd(cross.points[code].col) || cross.points[code].col === 'bx')
        parts.push('', `# 来源（跨学科）：${cross.subject} 初中和高中必修`, ...list.map(code => row(cross, code)))
    }
    writeFileSync(`generated/senior/judge/${slug}.txt`, `${parts.join('\n')}\n`)
    console.log(slug, parts.length, 'lines', Math.round(parts.join('').length / 1000), 'k chars')
}
