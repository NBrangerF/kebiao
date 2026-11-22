#!/usr/bin/env node
// Checks data/v2/graph/prereq/senior_<slug>.tsv (target, source, reason) by the rules in that folder's README.
import { readFileSync, readdirSync } from 'node:fs'

const slug = process.argv[2]
const start = new Map()
for (const file of readdirSync('public/data/v2/graph').filter(name => name.endsWith('.json') && !['search.json', 'manifest.json'].includes(name))) {
    const graph = JSON.parse(readFileSync(`public/data/v2/graph/${file}`, 'utf8'))
    const columns = Object.fromEntries(graph.columns.map(column => [column.key, column.start]))
    for (const [code, point] of Object.entries(graph.points)) start.set(code, point.col === 'shared' ? 7 : columns[point.col])
}
const lines = readFileSync(`data/v2/graph/prereq/senior_${slug}.tsv`, 'utf8').split('\n').filter(Boolean)
const errors = []
if (lines[0] !== 'target\tsource\treason') errors.push('第一行必须是 target<TAB>source<TAB>reason')
const before = new Map()
const seen = new Set()
for (const [index, line] of lines.slice(1).entries()) {
    const [target, source, reason, extra] = line.split('\t')
    const at = `第 ${index + 2} 行 ${source} → ${target}`
    if (extra !== undefined) errors.push(`${at}：列数不对`)
    if (!start.has(target) || !/-S5-/u.test(target)) errors.push(`${at}：目标不是高中要点`)
    if (!start.has(source)) errors.push(`${at}：来源编码不存在`)
    if (source === target) errors.push(`${at}：自己指向自己`)
    if (start.has(target) && start.has(source) && start.get(source) > start.get(target)) errors.push(`${at}：来源比目标晚（必修 < 选择性必修 < 选修）`)
    if (!reason?.trim()) errors.push(`${at}：没有依据`)
    else if ([...reason.trim()].length > 24) errors.push(`${at}：依据超过 24 字`)
    if (seen.has(`${source}>${target}`)) errors.push(`${at}：重复`)
    seen.add(`${source}>${target}`)
    before.set(target, [...(before.get(target) || []), source])
}
for (const [target, list] of before) if (list.length > 3) errors.push(`${target}：超过 3 条`)
const reaches = (from, to, visited = new Set()) => from === to || (!visited.has(from) && (visited.add(from), (before.get(from) || []).some(next => reaches(next, to, visited))))
for (const [target, list] of before) for (const source of list) if (reaches(source, target)) errors.push(`成环：${source} → ${target}`)
const total = [...start.keys()].filter(code => code.startsWith(`${lines[1]?.slice(0, 2)}-S5-`)).length
console.log(`${slug}: ${lines.length - 1} 条，覆盖 ${before.size}${total ? ` / ${total}` : ''} 个高中要点；错误 ${errors.length}`)
for (const line of errors.slice(0, 30)) console.log(`  ✗ ${line}`)
process.exitCode = errors.length ? 1 : 0
