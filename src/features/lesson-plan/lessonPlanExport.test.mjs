// node --test src/features/lesson-plan/lessonPlanExport.test.mjs
// Builds each Word export from a fixture plan, unzips the .docx and reads its text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
import { crc32, zip } from './zip.js'
import { downloadBriefWord, downloadObservationWord, downloadReflectionWord, downloadRubricWord, downloadScriptWord, downloadSkeletonWord, downloadUnitWord, downloadWord, joinItems, planToText, unitToText } from './lessonPlanExport.js'

// ---------- capture what a download would save ----------
let saved = null
globalThis.URL.createObjectURL = blob => { saved = { blob }; return 'blob:test' }
globalThis.URL.revokeObjectURL = () => {}
// the link is revoked a minute later; do not keep the test process waiting for that
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (...args) => { const timer = realSetTimeout(...args); timer.unref?.(); return timer }
globalThis.document = { body: { appendChild() {} }, createElement: () => ({ click() { saved.name = this.download }, remove() {} }) }

function unzip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let end = bytes.length - 22
    while (view.getUint32(end, true) !== 0x06054b50) end -= 1
    const count = view.getUint16(end + 10, true)
    let at = view.getUint32(end + 16, true)
    const files = {}
    for (let i = 0; i < count; i += 1) {
        const method = view.getUint16(at + 10, true)
        const crc = view.getUint32(at + 16, true)
        const size = view.getUint32(at + 20, true)
        const nameLength = view.getUint16(at + 28, true)
        const offset = view.getUint32(at + 42, true)
        const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
        const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true)
        const body = bytes.subarray(start, start + size)
        const data = method === 8 ? new Uint8Array(inflateRawSync(body)) : body
        assert.equal(crc32(data), crc, `crc of ${name}`)
        files[name] = new TextDecoder().decode(data)
        at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
    }
    return files
}

const unescape = text => text.replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&amp;/gu, '&')
const paragraphs = xml => [...xml.matchAll(/<w:p>(.*?)<\/w:p>/gu)].map(([, inner]) => ({
    style: inner.match(/<w:pStyle w:val="([^"]+)"/u)?.[1] || '',
    text: unescape(inner.replace(/<w:br\/>/gu, '\n').replace(/<[^>]+>/gu, ''))
}))

async function download(run) {
    saved = null
    await run()
    const files = unzip(new Uint8Array(await saved.blob.arrayBuffer()))
    const paras = paragraphs(files['word/document.xml'])
    return { name: saved.name, type: saved.blob.type, files, paras, text: paras.map(item => item.text).join('\n'), headings: paras.filter(item => item.style === 'Heading1').map(item => item.text) }
}

const NUMBERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']
const assertContinuous = headings => {
    const numbered = headings.filter(text => !text.startsWith('附'))
    numbered.forEach((text, index) => assert.ok(text.startsWith(`${NUMBERS[index]}、`), `heading ${index + 1} is 「${text}」 in ${numbered.join(' / ')}`))
}
const assertCleanJoins = text => {
    assert.doesNotMatch(text, /。；|；；|；。/u)
}

// ---------- fixtures: drafted items end with 。 or ；, the AI cites A1/O1, one statement is a kebiao summary ----------
const lesson = { title: '分数的基本性质', subject_name: '数学', subject_slug: 'math', grade: 5, edition_name: '人教版', textbook_title: '数学5年级下册' }
const evidence = [{ code: 'MA-S3-NA-01.3', text: '能用直观的方式表示分数和小数，能比较两个分数的大小。', pages: [31] }]
const frame = {
    title: '分数的基本性质（第1课时）',
    core_understanding: '分子分母同时乘或除以相同的数（0 除外），分数大小不变',
    objectives: [
        { id: 'O1', text: '学生能借助折纸说出分数的基本性质并解释理由。', basis: ['MA-S3-NA-01.3'], kind: '理解' },
        { id: 'O2', text: '学生能运用分数的基本性质把分数化成指定分母的分数；', basis: ['MA-S3-NA-01.3'], kind: '能做' }
    ],
    key_points: ['理解分数的基本性质。', '会用性质化简分数；'],
    difficult_points: ['理解 0 除外。'],
    strategies: ['先折纸再说理由（用于A1评价）。', '小步检查；'],
    learner_analysis: '学生已学过分数的意义。',
    prior_knowledge: ['分数的意义。', '商不变的规律；'],
    misconceptions: [{ text: '分子分母同时加相同的数大小不变。', response: '画图反例' }],
    keywords: [],
    assessments: [
        { id: 'A1', objective_ids: ['O1'], task: '用折纸说明 1/2=2/4（对应O1）', evidence: '折纸作品', criteria: '能说出理由；' },
        { id: 'A2', objective_ids: ['O2'], task: '化分母练习', evidence: '学习单', criteria: '全对' }
    ]
}
const process = {
    stages: [
        { name: '折纸探究（A1）', minutes: 25, org: '独立→同桌', teacher: '组织学生用正方形纸折出 1/2 和 2/4。再请同桌互说理由。', students: '折纸并记录', questions: [{ q: '1/2 和 2/4 哪个大？', expect: '一样大', follow: '折一折看看' }], check: '举手势表决', support: '看例图', purpose: '发现规律', objective_ids: ['O1'], assessment_ids: ['A1'] },
        { name: '练习', minutes: 15, org: '独立', teacher: '巡视', students: '完成学习单（A2）', check: '同桌互查', purpose: '运用', objective_ids: ['O2', 'O1'], assessment_ids: ['A2'] }
    ],
    homework: [{ level: '基础', task: '课本练习。', minutes: 10 }],
    board: ['分数的基本性质：分子分母同时乘或除以相同的数（0 除外），分数的大小不变——这一行写得很长也要留在页面里'],
    materials: [],
    safety: []
}
const reading = {
    reading: { points: [{ code: 'MA-S3-NA-01.3', plain: '会比较分数大小', verbs: [{ word: '比较', meaning: '能说明理由地比较。' }], this_lesson: '打基础', textbook: '折纸', avoid: '不要只背结论' }], position: '承接分数的意义', literacy: [] },
    links: [{ code: 'MA-S3-NA-01.3', before: [{ code: 'MA-S2-NA-01.3', text: '能初步认识分数；', grade: '3–4 年级', reason: '先懂含义' }], after: [], in_book: [] }],
    standards: [{ code: 'MA-S3-NA-01', title: '数与运算（5–6 年级）', stage_label: '第三学段（5–6 年级）', statement: '理解分数的意义和性质。', statement_source: 'kebiao_summary', requirements: ['能比较两个分数的大小。'], guidance: ['注重数的意义。'] }],
    limits: []
}
const practice = { items: [
    { kind: '练习', level: '基础', question: '把 2/3 化成分母是 12 的分数。', answer: '8/12', code: 'MA-S3-NA-01.3', objective_id: 'O1' },
    { kind: '检测', level: '变式', question: '3/4 和 9/12 相等吗？说明理由。', answer: '相等，分子分母同乘 3。', code: 'MA-S3-NA-01.3', objective_id: 'O2' }
] }
const plan = { lesson, meta: { period_minutes: 40, lesson_index: 1, lesson_count: 2, class_size: 45, lesson_type: '' }, frame, process, practice, reading, evidence, checks: [{ level: 'ok', message: '每条目标都有评价任务。' }] }

test('the 详案 is a real .docx: A4, 宋体/黑体, the zip parts Word and iPhone need', async () => {
    const doc = await download(() => downloadWord(plan))
    assert.equal(doc.name, '分数的基本性质-教案.docx')
    assert.equal(doc.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']) assert.ok(doc.files[part], part)
    assert.match(doc.files['word/document.xml'], /<w:pgSz w:w="11906" w:h="16838"\/>/u)
    assert.match(doc.files['word/styles.xml'], /w:eastAsia="宋体"/u)
    assert.match(doc.files['word/styles.xml'], /w:eastAsia="黑体"/u)
    // the header row of each table repeats on a new page
    assert.match(doc.files['word/document.xml'], /<w:tblHeader\/>/u)
})

test('the 详案 numbers the sections it has, joins items cleanly and keeps 教-学-评', async () => {
    const doc = await download(() => downloadWord(plan))
    // no 教学准备 (no materials): 教学过程 is 六, not 七
    assertContinuous(doc.headings)
    assert.ok(doc.headings.includes('六、教学过程'), doc.headings.join(' / '))
    assertCleanJoins(doc.text)
    assert.match(doc.text, /重点：理解分数的基本性质；会用性质化简分数\n/u)
    // each 环节 says which 目标 it moves and which 评价 it runs; the AI's ids read as 目标 n / 评价 n
    assert.ok(doc.text.includes('目标 1 · 评价 1'))
    assert.ok(doc.text.includes('目标 1、2 · 评价 2'))
    assert.ok(doc.text.includes('折纸探究（评价 1）'))
    assert.ok(doc.text.includes('用于评价 1）'))
    assert.ok(doc.text.includes('（对应目标 1）'))
    assert.doesNotMatch(doc.text, /(^|[^A-Za-z0-9])[AO]\d(?![0-9])/u)
    assert.ok(doc.paras.some(item => item.text === '评价 1'))
    // the header as schools write it: no doubled 课时, blanks for class, teacher and date
    assert.equal(doc.paras[0].text, '分数的基本性质')
    assert.ok(doc.text.includes('课型：＿＿＿＿＿　第 1 课时（共 2 课时）'))
    assert.ok(doc.text.includes('授课教师：＿＿＿＿＿'))
    // the 板书 sits in a table cell, so it wraps inside the page
    assert.match(doc.files['word/document.xml'], /<w:tc>.*分数的基本性质：分子分母同时乘/u)
})

test('kebiao 概括 statements are labelled; only the 要点 and 学业要求 are 课标原文', async () => {
    const doc = await download(() => downloadWord(plan))
    const line = doc.paras.find(item => item.text.startsWith('MA-S3-NA-01 数与运算'))
    assert.ok(line.text.includes('理解分数的意义和性质。（kebiao 概括，非课标原句）'), line.text)
    // the grade span is said once
    assert.ok(!line.text.includes('（第三学段（5–6 年级））'))
    const skeleton = await download(() => downloadSkeletonWord({ lesson: { ...lesson, unit_title: '4 分数的意义和性质' }, subject_note: { name: '数学' }, standards: [{ code: 'MA-S3-NA-01', title: '数与运算（5–6 年级）', statement: '理解分数的意义和性质。', statement_source: 'kebiao_summary', requirements: [], guidance: [], indicators: [{ code: 'MA-S3-NA-01.3', text: evidence[0].text, pages: [31] }] }] }, new Set(['MA-S3-NA-01.3'])))
    assert.equal(skeleton.name, '分数的基本性质-教案框架.docx')
    assert.ok(skeleton.text.includes('理解分数的意义和性质。（kebiao 概括，非课标原句）'))
    assert.ok(skeleton.text.includes('标「kebiao 概括」的标准句是 kebiao 的概括，不是课标原句'))
    assert.ok(skeleton.text.includes('修订版第 31 页'))
    assert.ok(skeleton.text.includes('授课教师：'))
})

test('the 复制 text matches the Word: same numbering, no 「。；」, 目标/评价 per 环节', () => {
    const text = planToText(plan)
    assertCleanJoins(text)
    assert.ok(text.startsWith('课题：分数的基本性质\n'))
    assert.ok(text.includes('\n六、教学过程\n'))
    assert.ok(text.includes('1. 折纸探究（评价 1）（25 分钟；独立→同桌；目标 1 · 评价 1）'))
    assert.ok(text.includes('评价 1（对应目标 1）'))
    assert.doesNotMatch(text, /(^|[^A-Za-z0-9])[AO]\d(?![0-9])/u)
})

test('a missing 当堂练习 leaves no gap in the numbering', async () => {
    const doc = await download(() => downloadWord({ ...plan, practice: null, process: { ...process, materials: ['正方形纸。'] } }))
    assertContinuous(doc.headings)
    assert.ok(doc.headings.includes('七、教学过程'))
    assert.ok(doc.headings.includes('八、板书设计'))
    assertContinuous(planToText({ ...plan, practice: null }).split('\n').filter(line => /^[一二三四五六七八九十]+、/u.test(line)))
})

test('O2 in 化学 is oxygen, not 目标 2', async () => {
    const chem = { ...plan, lesson: { ...lesson, subject_name: '化学', subject_slug: 'chemistry' }, process: { ...process, stages: [{ ...process.stages[0], teacher: '氧气由O2分子构成（O2），收集答题卡用于A1评价。' }, process.stages[1]] } }
    const doc = await download(() => downloadWord(chem))
    assert.ok(doc.text.includes('氧气由O2分子构成（O2），收集答题卡用于评价 1。'))
})

test('the 简案 fits a page: 课标 codes, the AI notice, 检测 only, short answers', async () => {
    const doc = await download(() => downloadBriefWord(plan))
    assert.equal(doc.name, '分数的基本性质-简案.docx')
    assert.ok(doc.text.includes('课标依据：MA-S3-NA-01.3'))
    assert.ok(doc.text.includes('（MA-S3-NA-01.3）'))
    assert.ok(doc.text.includes('题目和答案课前请核对'))
    assert.ok(doc.text.includes('0–25′'))
    assert.ok(doc.text.includes('25–40′'))
    assert.ok(doc.text.includes('目标 1 · 评价 1'))
    assert.ok(doc.text.includes('3/4 和 9/12 相等吗？'))
    assert.ok(!doc.text.includes('把 2/3 化成分母是 12 的分数'))
    assert.ok(doc.text.includes('另有练习 1 道，见详案'))
    // the first sentence of what the teacher does, no 预设
    assert.ok(doc.text.includes('组织学生用正方形纸折出 1/2 和 2/4'))
    assert.ok(!doc.text.includes('再请同桌互说理由'))
    assert.ok(!doc.text.includes('预设'))
    assertCleanJoins(doc.text)
    // smaller type and margins than the 详案
    assert.match(doc.files['word/styles.xml'], /<w:sz w:val="20"\/>/u)
})

test('观察表 and 反思表 join evidence cleanly and read 目标 n', async () => {
    const sheet = await download(() => downloadObservationWord(plan))
    assert.equal(sheet.name, '分数的基本性质-听课观察表.docx')
    assert.ok(sheet.text.includes('一、目标达成：每条目标看什么证据'))
    assert.ok(sheet.text.includes('目标 1、2'))
    assertCleanJoins(sheet.text)
    const reflection = await download(() => downloadReflectionWord(plan))
    assert.equal(reflection.name, '分数的基本性质-课后反思.docx')
    assert.ok(reflection.text.includes('折纸作品，达成标准：能说出理由'))
    assertCleanJoins(reflection.text)
    assertContinuous(reflection.headings)
})

const unit = {
    title: '分数的意义和性质', big_idea: '同一个数可以有多种等值的分数表示。', essential_questions: ['什么时候两个分数一样大？'],
    objectives: [{ id: 'O1', text: '学生能说明分数的意义；', basis: ['MA-S3-NA-01.3'], kind: '理解' }, { id: 'O2', text: '学生能化简分数。', basis: ['MA-S3-NA-01.3'], kind: '能做' }],
    performance_task: { title: '班级分饼会', scenario: '设计公平分配方案', product: '方案', criteria: ['史实准确：方案中的分数表示正确；', '能用分数说明为什么公平，并能画图说明自己的想法和理由；'] },
    assessments: [{ id: 'A1', objective_ids: ['O1'], task: '分配方案', evidence: '方案', criteria: '正确；' }, { id: 'A2', objective_ids: ['O2'], task: '化简小测（A2）', evidence: '小测', criteria: '全对' }],
    lessons: [{ title: '分数的意义', hours: 2, focus: '理解单位1，完成A1', objective_ids: ['O1'], assessment_ids: ['A1'] }, { title: '分数的基本性质', hours: 2, focus: '等值分数', objective_ids: ['O2', 'O1'], assessment_ids: ['A2'] }],
    prior_knowledge: ['分数的初步认识。'], connections: ''
}
const unitPlan = { unit, lesson, evidence, hours: 4 }

test('the unit design is structured: 目标 with 依据, 评价 and 课时安排 tables', async () => {
    const doc = await download(() => downloadUnitWord(unitPlan))
    assert.equal(doc.name, '分数的意义和性质-单元整体设计.docx')
    assertContinuous(doc.headings)
    assert.deepEqual(doc.headings, ['一、课标依据', '二、单元大概念与基本问题', '三、单元目标', '四、表现性任务：班级分饼会', '五、评价任务', '六、课时安排', '七、前置知识与前后联系'])
    // the big idea is a paragraph, not a heading
    assert.ok(doc.paras.some(item => item.style !== 'Heading1' && item.text === '大概念：同一个数可以有多种等值的分数表示。'))
    for (const head of ['课时', '课题', '课时数', '推进目标', '评价', '重点']) assert.ok(doc.paras.some(item => item.style === 'Cell' && item.text === head), head)
    assert.ok(doc.text.includes('理解单位1，完成评价 1'))
    assertCleanJoins(doc.text)
    assert.ok((await download(() => downloadUnitWord({ ...unitPlan, unit: { ...unit, performance_task: null } }))).headings.includes('四、评价任务'))
    const text = unitToText(unitPlan)
    assertCleanJoins(text)
    assert.ok(text.includes('2. 分数的基本性质（2 课时；目标 1、2 · 评价 2）：等值分数'))
})

test('the rubric names each row once: 「维度：……」 splits, a long criterion gets 维度 n', async () => {
    const doc = await download(() => downloadRubricWord(unitPlan))
    assert.equal(doc.name, '班级分饼会-评价量规.docx')
    const cells = doc.paras.filter(item => item.style === 'Cell').map(item => item.text)
    assert.ok(cells.includes('史实准确'))
    assert.ok(cells.includes('方案中的分数表示正确'))
    assert.ok(cells.includes('维度 2'))
    assert.equal(cells.filter(item => item.includes('能用分数说明为什么公平')).length, 1)
})

test('说课稿 / 试讲稿 time comes from the text, not the model', async () => {
    const said = '同学们好呀'.repeat(88) // 440 spoken 字: about 2 minutes
    const doc = await download(() => downloadScriptWord('《分数的基本性质》试讲稿', [
        { heading: '导入（约 6 分钟）', text: `${said}（模拟学生回答：${'一样大'.repeat(100)}）` },
        { heading: '板书', text: '分数的基本性质' },
        { heading: '答辩准备', text: '1. 依据是什么？\n依据 MA-S3-NA-01.3。' }
    ], '分数的基本性质-试讲稿'))
    assert.equal(doc.name, '分数的基本性质-试讲稿.docx')
    assert.ok(doc.headings.includes('导入（约 2 分钟）'), doc.headings.join(' / '))
    assert.ok(doc.text.includes('约 2 分钟（按每分钟约 220 字估算）'))
    // the simulated answer is grey
    assert.match(doc.files['word/document.xml'], /<w:color w:val="666666"\/><\/w:rPr><w:t xml:space="preserve">（模拟学生回答/u)
    const talk = await download(() => downloadScriptWord('《分数的基本性质》说课稿', [{ heading: '说教材', text: said }, { heading: '说学情', text: said }], '分数的基本性质-说课稿'))
    assert.ok(talk.text.includes('约 4 分钟'))
})

test('joinItems drops each item\'s own closing mark', () => {
    assert.equal(joinItems(['甲。', '乙；', ' 丙 ', '', '丁？']), '甲；乙；丙；丁？')
    assert.equal(joinItems(['纸。', '笔'], '、'), '纸、笔')
})

test('the zip reads back with or without CompressionStream', async () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
    const saved = globalThis.CompressionStream
    globalThis.CompressionStream = undefined
    try {
        const files = unzip(await zip([{ name: 'a.xml', data: '<a>课标</a>'.repeat(50) }]))
        assert.equal(files['a.xml'], '<a>课标</a>'.repeat(50))
    } finally {
        globalThis.CompressionStream = saved
    }
    const files = unzip(await zip([{ name: 'a.xml', data: '<a>课标</a>'.repeat(50) }, { name: 'b.bin', data: new Uint8Array([1, 2, 3]) }]))
    assert.equal(files['a.xml'], '<a>课标</a>'.repeat(50))
})

test('an empty table cell still holds a paragraph, or Word will not open the file', async () => {
    // a 讲授 环节: no 关键问题, no 看全班, no 学生活动; a 板书 but no 作业 or 练习
    const bare = { ...plan, practice: null, process: { ...process, homework: [], stages: [{ ...process.stages[0], questions: [], check: '', students: '', support: '' }, process.stages[1]] } }
    for (const run of [() => downloadWord(bare), () => downloadBriefWord(bare)]) {
        const xml = (await download(run)).files['word/document.xml']
        const cells = xml.match(/<w:tc>.*?<\/w:tc>/gu)
        assert.ok(cells.length)
        for (const cell of cells) assert.match(cell, /<w:p>/u, cell)
    }
})

test('A1 is 评价 1 only where it is cited as one: not an ammeter, a cell or a point', async () => {
    const cited = '（A1）用于A1评价，完成A1、A2。'
    const physics = { ...plan, practice: { items: [{ kind: '检测', level: '基础', question: '电流表A1示数0.3A（A1），A2示数多少？', answer: '0.5A', code: '', objective_id: 'O1' }] }, lesson: { ...lesson, subject_name: '物理', subject_slug: 'physics' }, process: { ...process, stages: [{ ...process.stages[0], teacher: `让学生读出电流表A1和A2的示数。${cited}`, questions: [{ q: '电流表A1的示数与A2有什么关系？', expect: '相等' }] }, process.stages[1]] } }
    const text = planToText(physics)
    assert.ok(text.includes('让学生读出电流表A1和A2的示数。（评价 1）用于评价 1，完成评价 1、评价 2。'), text)
    assert.ok(text.includes('电流表A1的示数与A2有什么关系？'))
    // the exercises of 物理 are left as written, even an id in brackets
    assert.ok(text.includes('电流表A1示数0.3A（A1），A2示数多少？'))
    const brief = await download(() => downloadBriefWord(physics))
    assert.ok(brief.text.includes('问：电流表A1的示数与A2有什么关系？'))
    const it = { ...plan, lesson: { ...lesson, subject_name: '信息科技', subject_slug: 'it' }, process: { ...process, stages: [{ ...process.stages[0], teacher: '在A1单元格输入公式（A2）。' }, process.stages[1]] } }
    assert.ok(planToText(it).includes('在A1单元格输入公式（评价 2）。'))
    const math = { ...plan, process: { ...process, stages: [{ ...process.stages[0], teacher: '在数轴上标出点A1，收集作品（A1）。' }, process.stages[1]] } }
    assert.ok(planToText(math).includes('在数轴上标出点A1，收集作品（评价 1）。'))
})
