// Turns a drafted lesson plan into plain text (复制) and Word files (.docx): the 详案, a one-page 简案 to take into class,
// the unit design, 说课稿 / 试讲稿, 听课观察表, 课后反思表, 教案框架 and the rubric. Each Word file is a list of blocks that
// docx.js writes; that writer is loaded only when a teacher downloads.

export const KIND_LABEL = { 知道: '知道', 理解: '理解', 能做: '能做' }

const NUMBERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五']
// Section numbers follow the sections a document really has, so a missing part leaves no gap
const counter = () => {
    let next = 0
    return title => `${NUMBERS[next++]}、${title}`
}

// The AI ends items with 。 or ；, so joining them as written gives 「。；」: drop each item's own closing mark first
const trimEnd = text => String(text ?? '').trim().replace(/[。．；;，,、\s]+$/u, '')
export const joinItems = (items, sep = '；') => (items || []).map(trimEnd).filter(Boolean).join(sep)

const pagesOf = item => `（修订版第 ${item.pages.join('、')} 页）`
const BLANK = '＿＿＿＿＿'
const fileSafe = name => String(name).replace(/[\\/:*?"<>|《》]/gu, '').trim()

// The AI often ends the title with 「（第1课时）」, which the header already says; a different number is kept
function titleOf(plan) {
    const title = plan.frame?.title || plan.lesson.title || '教案'
    const index = plan.meta?.lesson_index
    return title.replace(/\s*[（(]\s*第\s*(\d+)\s*课时\s*[）)]\s*$/u, (all, number) => (!index || Number(number) === Number(index) ? '' : all)) || title
}

const bookOf = lesson => (lesson.textbook_title ? `${lesson.edition_name || ''}${lesson.textbook_title}` : '')
const metaText = plan => {
    const { lesson, meta } = plan
    return [lesson.subject_name, lesson.grade ? `${lesson.grade} 年级` : '', bookOf(lesson), meta?.period_minutes ? `${meta.period_minutes} 分钟` : '', meta?.class_size ? `约 ${meta.class_size} 人` : ''].filter(Boolean).join(' · ')
}
const periodText = meta => (meta ? `第 ${meta.lesson_index} 课时（共 ${meta.lesson_count} 课时）` : '')
// What a school's 教案 header asks for: 课型, 课时, and blanks for the class, the teacher and the date
const headerFill = plan => [[`课型：${plan.meta?.lesson_type || BLANK}`, periodText(plan.meta)].filter(Boolean).join('　'), `授课班级：${BLANK}　授课教师：${BLANK}　授课时间：${BLANK}`]
const headerText = plan => [plan.meta?.lesson_type ? `课型：${plan.meta.lesson_type}` : '', periodText(plan.meta)].filter(Boolean).join(' · ')

// 教-学-评: objectives and assessments are read as 目标 n / 评价 n, never by the AI's ids
function numbering(objectives = [], assessments = []) {
    const objective = new Map(objectives.map((item, index) => [item.id, index + 1]))
    const assessment = new Map(assessments.map((item, index) => [item.id, index + 1]))
    const sorted = (map, ids) => [...new Set((ids || []).map(id => map.get(id)).filter(Boolean))].sort((x, y) => x - y)
    const goals = ids => sorted(objective, ids)
    const checks = ids => sorted(assessment, ids)
    const link = item => [goals(item.objective_ids).length ? `目标 ${goals(item.objective_ids).join('、')}` : '', checks(item.assessment_ids).length ? `评价 ${checks(item.assessment_ids).join('、')}` : ''].filter(Boolean).join(' · ')
    return { goals, checks, link, objective, assessment }
}

// The drafted text still cites 「A1」「O2」; read them as 评价 1 / 目标 2. A1 may be an ammeter, a cell or a point, so it
// becomes 评价 1 only when the words before make it one (「用于A1」) or it stands alone in brackets (「（A1）」); A4 paper
// stays. O2 may be oxygen or a circle's centre (sciences, 地理, 数学), so there it needs the words before (「推进 O4、O2」).
// In 物理, 信息科技 and 数学 the exercises are left as written.
const SUBJECTS_WITH_O = /化学|科学|生物|地理|物理|数学|chemistry|science|biology|geography|physics|math/u
const GOAL_WORDS = /(?:推进|对应|达成|目标|指向)\s*(?:O\d{1,2}\s*[、，,和与]\s*)*$/u
const CHECK_WORDS = /(?:评价|任务|对应|完成|用于|指向|达成)\s*(?:A\d{1,2}\s*[、，,和与]\s*)*$/u
const BRACKET_OPEN = /[（(]\s*(?:A\d{1,2}\s*[、，,和与]\s*)*$/u
const BRACKET_CLOSE = /^\s*(?:[、，,和与]\s*A\d{1,2}\s*)*[）)]/u
const EXERCISE_IDS_KEPT = /数学|物理|信息科技|math|physics|\sit$/u
const PAPER = /^(?:[^，。；、（()）\s]{0,3}纸|大小|尺寸|幅面|规格)/u
function relabeler(plan, objectives = [], assessments = []) {
    const { objective, assessment } = numbering(objectives, assessments)
    const subject = `${plan.lesson.subject_name || ''} ${plan.lesson.subject_slug || ''}`
    const keepO = SUBJECTS_WITH_O.test(subject)
    const relabel = text => String(text ?? '').replace(/(^|[^A-Za-z0-9.+\-_])([AO])(\d{1,2})(?![A-Za-z0-9])/gu, (all, before, letter, digits, offset, whole) => {
        const number = (letter === 'A' ? assessment : objective).get(`${letter}${digits}`)
        const head = whole.slice(0, offset + before.length)
        const tail = whole.slice(offset + all.length)
        if (!number || (letter === 'O' && keepO && !GOAL_WORDS.test(head))) return all
        if (letter === 'A' && (PAPER.test(tail) || !(CHECK_WORDS.test(head) || (BRACKET_OPEN.test(head) && BRACKET_CLOSE.test(tail))))) return all
        return `${before}${letter === 'A' ? '评价' : '目标'} ${number}`
    }).replace(/(评价|目标) ?\1 (\d+)/gu, '$1 $2').replace(/(评价|目标) (\d+)\1/gu, '$1 $2')
    relabel.exercise = EXERCISE_IDS_KEPT.test(subject) ? text => text : relabel
    return relabel
}

const linkLine = entry => `${entry.code}（${entry.grade}）${trimEnd(entry.text)}${entry.reason ? `——${trimEnd(entry.reason)}` : ''}`
const bookLine = link => link.in_book.map(entry => `${entry.lesson}${entry.current ? '（本课）' : ''}${entry.page ? `（PDF ${entry.page}）` : ''}`).join('；')
const readingOf = plan => ({
    points: new Map((plan.reading?.reading?.points || []).map(item => [item.code, item])),
    links: new Map((plan.reading?.links || []).map(item => [item.code, item]))
})
const homeworkLine = item => `【${item.level}】${trimEnd(item.task)}${item.minutes ? `（约 ${item.minutes} 分钟）` : ''}`
// What one 要点 means for this lesson, as label–text rows
const pointRows = (plan, code) => {
    const { points, links } = readingOf(plan)
    const point = points.get(code)
    const link = links.get(code)
    return [
        ['要做到', point?.plain],
        ['关键词', point?.verbs?.length ? joinItems(point.verbs.map(verb => `${verb.word}——${verb.meaning}`)) : ''],
        ['本课承担', point?.this_lesson],
        ['用教材教', point?.textbook],
        ['注意', point?.avoid],
        ['先学', link?.before?.length ? joinItems(link.before.map(linkLine)) : ''],
        ['后学', link?.after?.length ? joinItems(link.after.map(linkLine)) : ''],
        ['本册在哪教', link?.in_book?.length ? bookLine(link) : '']
    ].filter(([, text]) => text)
}
const readingRows = plan => {
    const { reading, frame } = plan
    return [
        ['这节课的位置', reading?.reading?.position],
        ['核心理解', frame?.core_understanding],
        ['素养表现', reading?.reading?.literacy?.length ? joinItems(reading.reading.literacy.map(item => `${item.name}——${item.look_for}`)) : ''],
        ['课标限定', reading?.limits?.length ? `${joinItems(reading.limits)}（本课不教、不考）` : '']
    ].filter(([, text]) => text)
}
// kebiao wrote most standard statements as a summary; only the 要点 and the 学业要求 / 教学提示 are 课标原文
const SUMMARY_NOTE = '（kebiao 概括，非课标原句）'
const statementNote = item => (item.statement_source === 'kebiao_summary' ? SUMMARY_NOTE : '')
// 「数与运算（5–6 年级）」 already names its grades; do not add 「（第三学段（5–6 年级））」 after it
const stageNote = item => {
    const span = String(item.stage_label || '').match(/（([^）]+)）/u)?.[1]
    return item.stage_label && !(span && String(item.title).includes(span)) ? `（${item.stage_label}）` : ''
}

const PLAN_FOOT = '本教案由 AI 依据 kebiao.org 收录的《义务教育课程标准（2022年版2025年修订）》要点起草，按常规大班课堂设计，请结合教材和班级实际修改后使用。'

function lines(plan) {
    const { frame, process, practice, evidence } = plan
    const t = relabeler(plan, frame?.objectives, frame?.assessments)
    const { goals, link } = numbering(frame?.objectives, frame?.assessments)
    const next = counter()
    const out = [`课题：${titleOf(plan)}`, metaText(plan)]
    if (headerText(plan)) out.push(headerText(plan))
    out.push('', next('课标分析（义务教育课程标准 2022年版2025年修订）'))
    for (const item of evidence || []) {
        out.push(`${item.code}　${item.text}${pagesOf(item)}`)
        for (const [label, text] of pointRows(plan, item.code)) out.push(`　${label}：${text}`)
    }
    for (const [label, text] of readingRows(plan)) out.push(`${label}：${text}`)
    if (frame) {
        out.push('', next('教学目标'))
        frame.objectives.forEach((item, index) => out.push(`${index + 1}. ${trimEnd(item.text)}（依据：${item.basis.join('、')}）`))
        out.push('', next('教学重点与难点'))
        out.push(`重点：${joinItems(frame.key_points)}`)
        out.push(`难点：${joinItems(frame.difficult_points)}`)
        if (frame.strategies?.length) out.push(`突破难点：${joinItems(frame.strategies.map(t))}`)
        out.push('', next('学情分析'))
        out.push(frame.learner_analysis)
        if (frame.prior_knowledge.length) out.push(`前置知识：${joinItems(frame.prior_knowledge)}`)
        if (frame.misconceptions.length) {
            out.push('常见误解与应对：')
            frame.misconceptions.forEach(item => out.push(`· ${trimEnd(item.text)}——${item.response}`))
        }
        if (frame.keywords.length) out.push(`关键词：${joinItems(frame.keywords.map(item => `${item.term}（${trimEnd(item.definition)}）`))}`)
        out.push('', next('评价任务'))
        frame.assessments.forEach((item, index) => out.push(`评价 ${index + 1}（对应目标 ${goals(item.objective_ids).join('、')}）${trimEnd(t(item.task))}　证据：${trimEnd(t(item.evidence))}　标准：${trimEnd(t(item.criteria))}`))
    }
    if (process) {
        if (process.materials.length || process.safety.length) {
            out.push('', next('教学准备'))
            if (process.materials.length) out.push(joinItems(process.materials, '、'))
            if (process.safety.length) out.push(`安全提示：${joinItems(process.safety)}`)
        }
        out.push('', next('教学过程'))
        process.stages.forEach((stage, index) => {
            out.push(`${index + 1}. ${t(stage.name)}（${[`${stage.minutes} 分钟`, stage.org, link(stage)].filter(Boolean).join('；')}）`)
            out.push(`   教师活动：${t(stage.teacher)}`)
            out.push(`   学生活动：${t(stage.students)}`)
            for (const item of stage.questions || []) out.push(`   关键问题：${t(item.q)}${item.expect ? `　预设：${t(item.expect)}` : ''}${item.follow ? `　追问：${t(item.follow)}` : ''}`)
            if (stage.check) out.push(`   看全班：${t(stage.check)}`)
            if (stage.support) out.push(`   照顾差异：${t(stage.support)}`)
            out.push(`   设计意图：${t(stage.purpose)}`)
        })
        if (practice?.items?.length) {
            out.push('', next('当堂练习与检测'))
            practice.items.forEach((item, index) => {
                out.push(`${index + 1}.【${item.kind}·${item.level}】${t.exercise(item.question)}${item.code ? `（${item.code}）` : ''}`)
                out.push(`   参考答案：${t.exercise(item.answer)}`)
            })
        }
        if (process.board.length) out.push('', next('板书设计'), ...process.board.map(t))
        if (process.homework.length) out.push('', next('作业设计'), ...process.homework.map(item => t(homeworkLine(item))))
    }
    out.push('', '本教案由 AI 依据 kebiao.org 收录的课标要点起草，请结合教材和班级实际修改后使用。')
    return out
}

export function planToText(plan) {
    return lines(plan).join('\n')
}

// ---------- Word ----------
const b = text => ({ text, b: true })
const dim = text => ({ text, dim: true })
const small = text => ({ text, dim: true, small: true })
const labelled = (label, text) => [b(`${label}：`), text]

// Body text: 小四 with Word's default Chinese margins; forms and the 简案 are tighter so they fit the page
const PLAN_PAGE = { margins: [1440, 1800, 1440, 1800], size: 24 }
const FORM_PAGE = { margins: [1020, 1077, 1020, 1077], size: 22 }
const BRIEF_PAGE = { margins: [737, 907, 737, 907], size: 20 }

async function saveDocx(blocks, fileName, page) {
    try {
        const { docxBlob } = await import('./docx.js')
        const name = fileSafe(fileName)
        const blob = await docxBlob(blocks, { title: name, page })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${name}.docx`
        document.body.appendChild(link)
        link.click()
        link.remove()
        // phones hand the file to another app; give them time before the link goes
        setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (error) {
        globalThis.alert?.('下载没有成功，请再试一次。')
        throw error
    }
}

function readingBlocks(plan) {
    const blocks = []
    for (const item of plan.evidence || []) {
        blocks.push({ type: 'p', runs: [b(item.code), ' ', item.text, dim(pagesOf(item))] })
        blocks.push(...pointRows(plan, item.code).map(([label, text]) => ({ type: 'indent', runs: labelled(label, text) })))
    }
    blocks.push(...readingRows(plan).map(([label, text]) => ({ type: 'p', runs: labelled(label, text) })))
    return blocks
}

export function planBlocks(plan) {
    const { frame, process, practice, reading, checks } = plan
    const t = relabeler(plan, frame?.objectives, frame?.assessments)
    const { goals, link } = numbering(frame?.objectives, frame?.assessments)
    const next = counter()
    const standards = reading?.standards || []
    const section = (title, blocks) => (blocks.length ? [{ type: 'h', text: next(title) }, ...blocks] : [])
    const stageCell = stage => ({ paras: [[b(t(stage.name))], [small(`${stage.minutes} 分钟`)], stage.org ? [small(stage.org)] : null, link(stage) ? [small(link(stage))] : null].filter(Boolean) })
    const teacherCell = stage => ({ paras: [
        t(stage.teacher),
        ...(stage.questions || []).map(item => [b('关键问题：'), t(item.q), item.expect ? small(`\n预设：${t(item.expect)}`) : '', item.follow ? small(`\n追问：${t(item.follow)}`) : '']),
        stage.check ? labelled('看全班', t(stage.check)) : null
    ].filter(Boolean) })
    const studentCell = stage => ({ paras: [t(stage.students), stage.support ? labelled('照顾差异', t(stage.support)) : null].filter(Boolean) })
    return [
        { type: 'title', text: titleOf(plan) },
        { type: 'meta', runs: metaText(plan) },
        ...headerFill(plan).map(runs => ({ type: 'meta', runs })),
        ...section('课标分析', readingBlocks(plan)),
        ...(frame ? [
            ...section('教学目标', [{ type: 'list', ordered: true, items: frame.objectives.map(item => [trimEnd(item.text), small(`　依据 ${item.basis.join('、')}`)]) }]),
            ...section('教学重点与难点', [
                { type: 'p', runs: labelled('重点', joinItems(frame.key_points)) },
                { type: 'p', runs: labelled('难点', joinItems(frame.difficult_points)) },
                frame.strategies?.length ? { type: 'p', runs: labelled('突破难点', joinItems(frame.strategies.map(t))) } : null
            ].filter(Boolean)),
            ...section('学情分析', [
                { type: 'p', runs: frame.learner_analysis },
                frame.prior_knowledge.length ? { type: 'p', runs: labelled('前置知识', joinItems(frame.prior_knowledge)) } : null,
                frame.misconceptions.length ? { type: 'p', runs: b('常见误解与应对：') } : null,
                frame.misconceptions.length ? { type: 'list', items: frame.misconceptions.map(item => `${trimEnd(item.text)}——${item.response}`) } : null,
                frame.keywords.length ? { type: 'p', runs: labelled('关键词', joinItems(frame.keywords.map(item => `${item.term}（${trimEnd(item.definition)}）`))) } : null
            ].filter(Boolean)),
            ...section('评价任务', [{ type: 'table', cols: [0.11, null, 0.23, 0.23, 0.1], head: ['评价', '任务', '证据', '达成标准', '目标'], rows: frame.assessments.map((item, index) => [`评价 ${index + 1}`, trimEnd(t(item.task)), trimEnd(t(item.evidence)), trimEnd(t(item.criteria)), goals(item.objective_ids).join('、')]) }])
        ] : []),
        ...(process ? [
            ...section('教学准备', [
                process.materials.length ? { type: 'p', runs: joinItems(process.materials, '、') } : null,
                process.safety.length ? { type: 'p', runs: labelled('安全提示', joinItems(process.safety)) } : null
            ].filter(Boolean)),
            ...section('教学过程', [{ type: 'table', cols: [0.15, null, null, 0.18], head: ['环节', '教师活动', '学生活动', '设计意图'], rows: process.stages.map(stage => [stageCell(stage), teacherCell(stage), studentCell(stage), t(stage.purpose)]) }]),
            ...section('当堂练习与检测', practice?.items?.length ? [
                { type: 'list', ordered: true, items: practice.items.map(item => [`【${item.kind}·${item.level}】${t.exercise(item.question)}`, item.code ? small(`　${item.code}`) : '', dim(`\n参考答案：${t.exercise(item.answer)}`)]) },
                { type: 'note', runs: '题目和答案由 AI 起草，课前请核对。' }
            ] : []),
            ...section('板书设计', process.board.length ? [{ type: 'box', lines: process.board.map(t) }] : []),
            ...section('作业设计', process.homework.length ? [{ type: 'list', items: process.homework.map(item => t(homeworkLine(item))) }] : []),
            ...section('教学反思', [{ type: 'box', lines: [small('课后填写：目标达成情况、学生的典型错误、下次要改的地方')], minHeight: 2200 }])
        ] : []),
        ...(checks?.length ? [{ type: 'h', text: '附：核验' }, { type: 'list', items: checks.map(item => t(item.message)) }] : []),
        ...(standards.some(item => item.requirements.length || item.guidance.length) ? [
            { type: 'h', text: '附：课标原文' },
            ...standards.flatMap(item => [
                { type: 'p', runs: [b(`${item.code} ${item.title}`), stageNote(item), item.statement ? `：${item.statement}` : '', item.statement ? small(statementNote(item)) : ''] },
                item.requirements.length ? { type: 'indent', runs: labelled('学业要求', item.requirements.join(' ')) } : null,
                item.guidance.length ? { type: 'indent', runs: labelled('教学提示', item.guidance.join(' ')) } : null
            ].filter(Boolean)),
            standards.some(item => item.statement && statementNote(item)) ? { type: 'note', runs: '标「kebiao 概括」的是 kebiao 对所在标准的概括，引用时请用上面的要点、学业要求和教学提示原文。' } : null
        ].filter(Boolean) : []),
        { type: 'foot', runs: PLAN_FOOT }
    ]
}

export function downloadWord(plan) {
    return saveDocx(planBlocks(plan), `${titleOf(plan)}-教案`, PLAN_PAGE)
}

// ---------- 简案: one page to take into class — the clock, what to do and ask, how to see the class, the 检测, the board ----------
// The first sentence of what the teacher does (two when the first is very short); the full text is in the 详案
const firstSentence = text => {
    const parts = String(text || '').match(/[^。；]+[。；]?/gu) || ['']
    return trimEnd(parts[0].length < 14 && parts[1] ? parts[0] + parts[1] : parts[0])
}
const clip = (text, length) => {
    const plain = trimEnd(String(text || '').replace(/\s+/gu, ' '))
    return plain.length > length ? `${plain.slice(0, length)}…` : plain
}

export function briefBlocks(plan) {
    const { frame, process, practice, evidence } = plan
    const t = relabeler(plan, frame?.objectives, frame?.assessments)
    const { link } = numbering(frame?.objectives, frame?.assessments)
    let clock = 0
    const rows = (process?.stages || []).map(stage => {
        const from = clock
        clock += stage.minutes
        const asks = (stage.questions || []).map(item => `问：${t(item.q)}`)
        return [`${from}–${clock}′`, { paras: [[b(t(stage.name))], stage.org ? [small(stage.org)] : null, link(stage) ? [small(link(stage))] : null].filter(Boolean) }, t(firstSentence(stage.teacher)), { paras: [...asks, stage.check ? labelled('看全班', t(stage.check)) : null].filter(Boolean) }]
    })
    const all = practice?.items || []
    const tests = all.some(item => item.kind === '检测') ? all.filter(item => item.kind === '检测') : all
    const board = (process?.board || []).map(t)
    const homework = (process?.homework || []).map(item => `【${item.level}】${clip(t(item.task), 40)}${item.minutes ? `（约 ${item.minutes} 分钟）` : ''}`)
    return [
        { type: 'title', text: `${titleOf(plan)}（简案）` },
        { type: 'meta', runs: [metaText(plan), headerText(plan)].filter(Boolean).join(' · ') },
        evidence?.length ? { type: 'p', runs: [b('课标依据：'), ...evidence.flatMap((item, index) => [index ? '；' : '', b(item.code), ' ', trimEnd(item.text), dim(pagesOf(item))])] } : null,
        frame ? { type: 'p', runs: [b('目标：'), ...frame.objectives.flatMap((item, index) => [index ? '　' : '', `${index + 1}. ${trimEnd(item.text)}`, small(`（${item.basis.join('、')}）`)])] } : null,
        frame ? { type: 'p', runs: [...labelled('重点', joinItems(frame.key_points)), '　', ...labelled('难点', joinItems(frame.difficult_points))] } : null,
        rows.length ? { type: 'table', cols: [0.08, 0.17, null, 0.36], head: ['时间', '环节', '做什么', '关键问题 · 看全班'], rows } : null,
        tests.length ? { type: 'p', runs: [b(tests.length < all.length ? '当堂检测：' : '练习与检测：'), tests.length < all.length ? small(`（另有练习 ${all.length - tests.length} 道，见详案）`) : ''] } : null,
        tests.length ? { type: 'list', ordered: true, items: tests.map(item => `【${item.level}】${t.exercise(item.question)}`) } : null,
        // the 板书 beside the 作业 and short answers (the full answers are in the 详案), to keep to one page
        board.length || homework.length || tests.length ? { type: 'table', cols: [0.45, null], head: ['板书', '作业 · 答案'], rows: [[
            { paras: board.length ? board : [''] },
            { paras: [homework.length ? labelled('作业', homework.join('　')) : null, tests.length ? [b('答案：'), tests.map((item, index) => `${index + 1}. ${clip(t.exercise(item.answer), 40)}`).join('　')] : null].filter(Boolean) }
        ]] } : null,
        { type: 'foot', runs: 'AI 依据 kebiao.org 收录的《义务教育课程标准（2022年版2025年修订）》要点起草，题目和答案课前请核对。' }
    ].filter(Boolean)
}

export function downloadBriefWord(plan) {
    return saveDocx(briefBlocks(plan), `${titleOf(plan)}-简案`, BRIEF_PAGE)
}

// ---------- 单元整体设计 ----------
const unitTitle = plan => plan.unit.title || plan.lesson.title || '单元'
const UNIT_FOOT = '本单元设计由 AI 依据 kebiao.org 收录的《义务教育课程标准（2022年版2025年修订）》要点起草，请结合教材和班级实际修改后使用。'

function unitLines(plan) {
    const { unit, lesson, evidence, hours } = plan
    const t = relabeler(plan, unit.objectives, unit.assessments)
    const { goals, link } = numbering(unit.objectives, unit.assessments)
    const next = counter()
    const out = [`《${unitTitle(plan)}》单元整体教学设计`]
    out.push([lesson.subject_name, lesson.grade ? `${lesson.grade} 年级` : '', bookOf(lesson), `共 ${hours} 课时`].filter(Boolean).join(' · '))
    out.push('', next('课标依据（义务教育课程标准 2022年版2025年修订）'))
    for (const item of evidence || []) out.push(`${item.code}　${item.text}${pagesOf(item)}`)
    out.push('', next('单元大概念与基本问题'), `大概念：${unit.big_idea}`)
    if (unit.essential_questions.length) out.push(`基本问题：${unit.essential_questions.join(' / ')}`)
    out.push('', next('单元目标'))
    unit.objectives.forEach((item, index) => out.push(`${index + 1}. ${trimEnd(item.text)}（依据：${item.basis.join('、')}）`))
    if (unit.performance_task) {
        out.push('', next(`表现性任务：${unit.performance_task.title}`))
        out.push(`情境：${unit.performance_task.scenario}`, `作品：${unit.performance_task.product}`, `评价标准：${joinItems(unit.performance_task.criteria)}`)
    }
    out.push('', next('评价任务'))
    unit.assessments.forEach((item, index) => out.push(`评价 ${index + 1}（目标 ${goals(item.objective_ids).join('、')}）${trimEnd(t(item.task))}　证据：${trimEnd(t(item.evidence))}　标准：${trimEnd(t(item.criteria))}`))
    out.push('', next('课时安排'))
    unit.lessons.forEach((item, index) => out.push(`${index + 1}. ${item.title}（${[`${item.hours} 课时`, link(item)].filter(Boolean).join('；')}）：${t(item.focus)}`))
    if (unit.prior_knowledge.length || unit.connections) {
        out.push('', next('前置知识与前后联系'))
        if (unit.prior_knowledge.length) out.push(`前置知识：${joinItems(unit.prior_knowledge)}`)
        if (unit.connections) out.push(`前后联系：${unit.connections}`)
    }
    out.push('', UNIT_FOOT)
    return out
}

export function unitToText(plan) {
    return unitLines(plan).join('\n')
}

export function unitBlocks(plan) {
    const { unit, lesson, evidence, hours } = plan
    const t = relabeler(plan, unit.objectives, unit.assessments)
    const { goals, checks } = numbering(unit.objectives, unit.assessments)
    const next = counter()
    const task = unit.performance_task
    return [
        { type: 'title', text: `《${unitTitle(plan)}》单元整体教学设计` },
        { type: 'meta', runs: [lesson.subject_name, lesson.grade ? `${lesson.grade} 年级` : '', bookOf(lesson), `共 ${hours} 课时`].filter(Boolean).join(' · ') },
        { type: 'h', text: next('课标依据') },
        ...(evidence || []).map(item => ({ type: 'p', runs: [b(item.code), ' ', item.text, dim(pagesOf(item))] })),
        { type: 'h', text: next('单元大概念与基本问题') },
        { type: 'p', runs: labelled('大概念', unit.big_idea) },
        ...(unit.essential_questions.length ? [{ type: 'p', runs: b('基本问题：') }, { type: 'list', ordered: true, items: unit.essential_questions }] : []),
        { type: 'h', text: next('单元目标') },
        { type: 'table', cols: [0.11, null, 0.24], head: ['目标', '学生能……', '依据'], rows: unit.objectives.map((item, index) => [`目标 ${index + 1}`, trimEnd(item.text), item.basis.join('\n')]) },
        ...(task ? [
            { type: 'h', text: next(`表现性任务：${task.title}`) },
            { type: 'p', runs: labelled('情境', task.scenario) },
            { type: 'p', runs: labelled('作品', task.product) },
            { type: 'p', runs: b('评价标准：') },
            { type: 'list', ordered: true, items: task.criteria.map(trimEnd) }
        ] : []),
        { type: 'h', text: next('评价任务') },
        { type: 'table', cols: [0.11, null, 0.25, 0.23, 0.1], head: ['评价', '任务', '证据', '达成标准', '目标'], rows: unit.assessments.map((item, index) => [`评价 ${index + 1}`, trimEnd(t(item.task)), trimEnd(t(item.evidence)), trimEnd(t(item.criteria)), goals(item.objective_ids).join('、')]) },
        { type: 'h', text: next('课时安排') },
        { type: 'table', cols: [0.07, 0.2, 0.08, 0.1, 0.1, null], head: ['课时', '课题', '课时数', '推进目标', '评价', '重点'], rows: unit.lessons.map((item, index) => [String(index + 1), item.title, String(item.hours), goals(item.objective_ids).join('、'), checks(item.assessment_ids).join('、'), t(item.focus)]) },
        ...(unit.prior_knowledge.length || unit.connections ? [
            { type: 'h', text: next('前置知识与前后联系') },
            unit.prior_knowledge.length ? { type: 'p', runs: labelled('前置知识', joinItems(unit.prior_knowledge)) } : null,
            unit.connections ? { type: 'p', runs: labelled('前后联系', unit.connections) } : null
        ].filter(Boolean) : []),
        { type: 'foot', runs: UNIT_FOOT }
    ]
}

export function downloadUnitWord(plan) {
    return saveDocx(unitBlocks(plan), `${unitTitle(plan)}-单元整体设计`, PLAN_PAGE)
}

// ---------- 说课稿 / 试讲稿: a heading per section, paragraphs as written ----------
// Time comes from the text itself, at about 220 spoken 字 a minute: the model's own number runs short. The simulated
// answers and 板书 cues in （） are not said by the teacher; in Word they are grey, as on the page.
const CUE = /(（(?:模拟[^：:）]{0,10}|板书)[：:][^）]*）)/u
const spokenMinutes = text => Math.max(0.5, Math.round((String(text).split(CUE).filter((_, index) => !(index % 2)).join('').match(/\p{Script=Han}/gu) || []).length / 110) / 2)
const TIMED = /（约\s*\d+\s*分钟）$/u

export function scriptBlocks(title, sections) {
    const timed = sections.some(item => TIMED.test(item.heading))
    const spoken = sections.filter(item => !timed || TIMED.test(item.heading))
    const minutes = spoken.reduce((sum, item) => sum + spokenMinutes(item.text), 0)
    return [
        { type: 'title', text: title },
        { type: 'meta', runs: `约 ${minutes} 分钟（按每分钟约 220 字估算）` },
        ...sections.flatMap(({ heading, text }) => [
            { type: 'h', text: TIMED.test(heading) ? heading.replace(TIMED, `（约 ${spokenMinutes(text)} 分钟）`) : heading },
            ...String(text).split(/\n+/u).filter(Boolean).map(line => ({ type: 'body', runs: line.split(CUE).map((part, index) => (index % 2 ? dim(part) : part)) }))
        ]),
        { type: 'foot', runs: '由 AI 根据教案改写（kebiao.org），请结合自己的理解修改后使用。' }
    ]
}

export function downloadScriptWord(title, sections, fileName) {
    return saveDocx(scriptBlocks(title, sections), fileName, PLAN_PAGE)
}

// ---------- 听课观察表: built from the plan itself (no AI), for 听评课, 公开课 and 磨课 ----------
const formMeta = plan => [plan.lesson.subject_name, plan.lesson.grade ? `${plan.lesson.grade} 年级` : '', bookOf(plan.lesson), plan.meta ? `${plan.meta.period_minutes} 分钟` : ''].filter(Boolean).join(' · ')

export function observationBlocks(plan) {
    const { frame, process, evidence } = plan
    const t = relabeler(plan, frame?.objectives, frame?.assessments)
    const { goals } = numbering(frame?.objectives, frame?.assessments)
    const assessmentsOf = id => (frame?.assessments || []).filter(item => item.objective_ids.includes(id))
    return [
        { type: 'title', text: `《${titleOf(plan)}》听课观察表` },
        { type: 'meta', runs: formMeta(plan) },
        { type: 'p', runs: `授课教师：${BLANK}　听课人：${BLANK}　日期：${BLANK}　班级：${BLANK}` },
        { type: 'h', text: '一、目标达成：每条目标看什么证据' },
        { type: 'table', cols: [0.22, 0.13, 0.19, 0.16, 0.1, null], minHeight: 840, head: ['教学目标', '课标要点', '看什么（评价证据）', '达成标准', '达成情况', '观察记录'], rows: (frame?.objectives || []).map((item, index) => {
            const found = assessmentsOf(item.id)
            return [`${index + 1}. ${trimEnd(item.text)}`, item.basis.join('\n'), joinItems(found.map(entry => t(entry.evidence || entry.task))) || '（教案没有写评价证据）', joinItems(found.map(entry => t(entry.criteria))), '□达到\n□部分\n□未达到', '']
        }) },
        { type: 'h', text: '二、教学环节：学生在做什么' },
        { type: 'table', cols: [0.2, 0.3, 0.12, null, 0.1], minHeight: 840, head: ['环节', '学生应该做的', '推进的目标', '观察记录（学生的表现、问题）', '实际用时'], rows: (process?.stages || []).map((stage, index) => [{ paras: [`${index + 1}. ${t(stage.name)}`, [small(`计划 ${stage.minutes} 分钟`)]] }, t(stage.students), goals(stage.objective_ids).length ? `目标 ${goals(stage.objective_ids).join('、')}` : '', '', '']) },
        { type: 'h', text: '三、整体评价' },
        { type: 'p', runs: '教—学—评一致性：□一致　□基本一致　□不一致　　学生主体活动时间约＿＿分钟' },
        { type: 'p', runs: '课标要点落实：' },
        { type: 'list', bullet: '□', items: (evidence || []).map(item => `${item.code}　${item.text}${pagesOf(item)}`) },
        { type: 'box', lines: ['主要优点：'], minHeight: 1100 },
        { type: 'box', lines: ['改进建议：'], minHeight: 1100 },
        { type: 'foot', runs: '观察表由教案的目标、评价任务和教学过程生成（kebiao.org），课标要点依据《义务教育课程标准（2022年版2025年修订）》。' }
    ]
}

export function downloadObservationWord(plan) {
    return saveDocx(observationBlocks(plan), `${titleOf(plan)}-听课观察表`, FORM_PAGE)
}

// ---------- 课后反思表: the plan's own objectives, evidence and expected difficulties, to fill in after class (no AI) ----------
export function reflectionBlocks(plan) {
    const { frame, process } = plan
    const t = relabeler(plan, frame?.objectives, frame?.assessments)
    const assessmentsOf = id => (frame?.assessments || []).filter(item => item.objective_ids.includes(id))
    const next = counter()
    const expected = [
        ...(frame?.difficult_points || []).map(text => ({ kind: '难点', text, response: '' })),
        ...(frame?.misconceptions || []).map(item => ({ kind: '易错', text: item.text, response: item.response }))
    ]
    return [
        { type: 'title', text: `《${titleOf(plan)}》课后反思` },
        { type: 'meta', runs: formMeta(plan) },
        { type: 'p', runs: `上课日期：${BLANK}　班级：${BLANK}` },
        { type: 'h', text: next('目标达成了吗：对照课前定的证据') },
        { type: 'table', cols: [0.3, 0.27, 0.13, null], minHeight: 840, head: ['教学目标', '课前定的证据和标准', '达成情况', '没达成的原因 / 依据（作业、练习、课堂表现）'], rows: (frame?.objectives || []).map((item, index) => {
            const evidence = joinItems(assessmentsOf(item.id).map(entry => [trimEnd(t(entry.evidence || entry.task)), trimEnd(t(entry.criteria))].filter(Boolean).join('，达成标准：')))
            return [{ paras: [`${index + 1}. ${trimEnd(item.text)}`, [small(item.basis.join('、'))]] }, evidence || '（教案没有写评价证据）', '约＿＿人达成\n共＿＿人', '']
        }) },
        ...(expected.length ? [
            { type: 'h', text: next('预设的难点和易错点，课上出现了吗') },
            { type: 'table', cols: [0.34, 0.11, null, 0.27], minHeight: 840, head: ['预设', '课上', '学生实际的说法或做法', '下次怎么调整'], rows: expected.map(item => [{ paras: [[b(item.kind), `　${trimEnd(item.text)}`], item.response ? [small(`预设对策：${item.response}`)] : null].filter(Boolean) }, '□出现\n□没出现', '', '']) }
        ] : []),
        { type: 'h', text: next('时间花在哪里') },
        { type: 'table', cols: [0.3, 0.12, 0.12, null], minHeight: 600, head: ['环节', '计划', '实际', '原因和调整'], rows: (process?.stages || []).map((stage, index) => [`${index + 1}. ${t(stage.name)}`, `${stage.minutes} 分钟`, '', '']) },
        { type: 'h', text: next('意外和收获') },
        { type: 'box', lines: ['课上出现的、教案没有预设到的情况：'], minHeight: 1200 },
        { type: 'box', lines: ['下次再教这一课，我会：'], minHeight: 1200 },
        { type: 'foot', runs: '反思表由教案的目标、评价证据和预设难点生成（kebiao.org）。先写证据，再写感受：哪条目标多少学生达成，依据是什么。' }
    ]
}

export function downloadReflectionWord(plan) {
    return saveDocx(reflectionBlocks(plan), `${titleOf(plan)}-课后反思`, FORM_PAGE)
}

// ---------- 教案框架 / 单元设计框架: the ticked 要点 verbatim and blank sections in evidence-first order, for teachers
// who write in their school's own template or when the AI is unavailable (no AI). A unit lists its real lessons. ----------
const skeletonTitle = context => (context.unit_lessons?.length ? (context.lesson.unit_title || context.lesson.title).replace(/^\d+\s*/u, '') : context.lesson.title)

export function skeletonBlocks(context, selected) {
    const lesson = context.lesson
    const unitLessons = context.unit_lessons?.length ? context.unit_lessons : null
    const standards = context.standards
        .map(standard => ({ ...standard, points: standard.indicators.filter(item => selected.has(item.code)) }))
        .filter(standard => standard.points.length)
    const points = standards.flatMap(standard => standard.points)
    const blank = (cols, head, rows, minHeight = 800) => ({ type: 'table', cols, head, rows, minHeight })
    // the hint sits inside the box: Apple's preview sizes a table by its text, so an empty box would show as a sliver
    const box = (hint, minHeight = 1100) => [{ type: 'box', lines: [small(hint)], minHeight }]
    const fill = `＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿`
    const goals = blank([0.12, null, 0.24], ['目标', '学生能……', '依据要点'], points.map((item, index) => [`目标 ${index + 1}`, '学生能＿＿＿＿＿＿＿＿＿＿＿＿＿＿（条件 + 看得见的行为 + 程度）', item.code]), 0)
    const basis = standards.flatMap(standard => [
        { type: 'p', runs: [b(`${standard.code} ${standard.title}`), standard.statement ? `\n${standard.statement}` : '', standard.statement ? small(statementNote(standard)) : ''] },
        { type: 'list', items: standard.points.map(item => [b(item.code), `　${item.text}`, dim(pagesOf(item))]) },
        standard.requirements?.length ? { type: 'note', runs: `学业要求：${joinItems(standard.requirements)}` } : null,
        standard.guidance?.length ? { type: 'note', runs: `教学提示：${joinItems(standard.guidance)}` } : null
    ].filter(Boolean))
    const body = unitLessons ? [
        { type: 'h', text: '二、单元内容分析' }, ...box('这个单元在整册、整个学段里的位置：前面学过什么，后面接着学什么。'),
        { type: 'h', text: '三、学情分析' }, ...box('学生已经会什么，可能在哪里出错。'),
        { type: 'h', text: '四、单元大概念' }, ...box('用一句完整的话写出学生学完要真正理解、能迁移的观点，不是知识点的名称。'),
        { type: 'h', text: '五、基本问题' }, { type: 'p', runs: `1. ${fill}？` }, { type: 'p', runs: `2. ${fill}？` },
        { type: 'h', text: '六、单元目标' }, goals,
        { type: 'h', text: '七、表现性任务（单元评价，先定证据）' },
        blank([0.27, 0.27, 0.32, null], ['任务情境', '学生要交出的作品或表现', '评价标准（量规）', '对应目标'], [['', '', '', '']], 1100),
        { type: 'h', text: '八、课时安排' },
        blank([0.08, 0.3, 0.1, 0.14, null], ['课时', '课题', '课时数', '主要目标', '关键活动与评价'], unitLessons.map((item, index) => [String(index + 1), item.title, String(item.hours || ''), '', ''])),
        { type: 'h', text: '九、单元作业与反思' }, ...box('单元作业怎样分层；学完后哪条目标达成得不好，下次怎么调整。')
    ] : [
        { type: 'p', runs: b('课标分析') },
        { type: 'hint', runs: '逐条写：这条要点要学生最终做到什么；关键行为词（理解、运用……）要求到什么程度；本课承担哪一部分；先学的是什么、后面用到哪里。' },
        blank([0.2, null, 0.35], ['要点', '要做到 · 关键词的程度', '本课承担'], points.map(item => [item.code, '', ''])),
        { type: 'h', text: '二、教材分析（用教材教）' }, ...box('教材用了哪些情境、例题和活动，各为哪条要点服务；哪些可以换成学生熟悉的情境，哪些需要补充；只按教材讲容易漏掉或超出什么。'),
        { type: 'h', text: '三、学情分析' }, ...box('多数学生的起点，容易卡在哪里；学得快和学得慢的学生各需要什么。'),
        { type: 'h', text: '四、教学目标' }, goals,
        { type: 'h', text: '五、教学重点和难点' }, { type: 'p', runs: `重点：${fill}` }, { type: 'p', runs: `难点：${fill}` }, { type: 'p', runs: `突破难点：${fill}` },
        { type: 'h', text: '六、评价任务（先定证据，再设计活动）' },
        blank([0.12, null, 0.28, 0.28], ['对应目标', '学生要完成的任务', '看什么证据', '达成标准'], points.map((_, index) => [`目标 ${index + 1}`, '', '', ''])),
        { type: 'h', text: '七、教学过程' },
        { type: 'hint', runs: '讲之前先让学生想一想、试一试（独立 1–3 分钟，再同桌交流）；每讲一步用一个问题或小题检查；写清老师怎样看到全班学会没有（手势表决、同桌互查、巡视抽看……）。' },
        blank([0.12, 0.07, 0.08, null, 0.2, 0.16, 0.07], ['环节', '时间', '组织', '教师活动与关键问题', '学生活动', '设计意图', '目标'], ['回顾检测', '情境与问题', '先试', '讲解与示范', '练习与反馈', '当堂检测', '小结'].map(name => [name, '', '', '', '', '', ''])),
        { type: 'h', text: '八、当堂练习与检测' }, ...box('基础题、变式题、提高题各一两道；最后两三道作当堂检测，3–5 分钟做完。'),
        { type: 'h', text: '九、板书设计' }, ...box('板书的主要内容和结构，写在黑板上的位置。'),
        { type: 'h', text: '十、作业设计' }, { type: 'p', runs: `基础（必做，约＿＿分钟）：${fill}` }, { type: 'p', runs: `提高（选做，约＿＿分钟）：${fill}` },
        { type: 'h', text: '十一、教学反思' }, ...box('课后填写：目标达成情况、学生的典型错误、下次要改的地方。')
    ]
    const summary = standards.some(standard => standard.statement && statementNote(standard))
    return [
        { type: 'title', text: `《${skeletonTitle(context)}》${unitLessons ? '单元整体教学设计' : '教学设计'}` },
        { type: 'meta', runs: [context.subject_note?.name, lesson.grade ? `${lesson.grade} 年级` : '', bookOf(lesson), unitLessons ? `共 ${unitLessons.length} 课` : lesson.unit_title || ''].filter(Boolean).join(' · ') },
        ...(unitLessons ? [] : [{ type: 'meta', runs: `课型：${BLANK}　第＿课时（共＿课时）　授课班级：${BLANK}　授课教师：${BLANK}　授课时间：${BLANK}` }]),
        { type: 'h', text: '一、课标依据' },
        ...basis,
        ...body,
        { type: 'foot', runs: `要点逐字摘自《义务教育课程标准（2022年版2025年修订）》（kebiao.org）${summary ? '；标「kebiao 概括」的标准句是 kebiao 的概括，不是课标原句' : ''}。` }
    ]
}

export function downloadSkeletonWord(context, selected) {
    return saveDocx(skeletonBlocks(context, selected), `${skeletonTitle(context)}-${context.unit_lessons?.length ? '单元设计框架' : '教案框架'}`, FORM_PAGE)
}

// ---------- 表现性任务量规: one row per criterion, three levels; 「达到」 is the criterion as drafted, the two below are
// for the teacher to write as visible behaviour (no AI). A criterion written 「史实准确：……」 names its own row. ----------
const dimensionOf = (criterion, index) => {
    const text = trimEnd(criterion)
    const at = text.search(/[：:]/u)
    return at > 0 && at <= 12 ? [text.slice(0, at), text.slice(at + 1).trim()] : [`维度 ${index + 1}`, text]
}

export function rubricBlocks(plan) {
    const { unit } = plan
    const task = unit.performance_task
    return [
        { type: 'title', text: `表现性任务「${task.title}」评价量规` },
        { type: 'meta', runs: `《${unitTitle(plan)}》单元` },
        { type: 'p', runs: labelled('任务情境', task.scenario) },
        { type: 'p', runs: labelled('学生交出', task.product) },
        { type: 'hint', runs: '「达到」一栏是单元设计里写的评价标准。请把「基本达到」「尚未达到」写成看得见的表现（学生做了什么、缺了什么），不要只写「较好」「一般」。可以先发给学生，让他们对照着做、对照着自评。' },
        { type: 'table', cols: [0.17, 0.31, 0.26, null], minHeight: 900, head: ['评价维度', '达到', '基本达到', '尚未达到'], rows: task.criteria.map((criterion, index) => [...dimensionOf(criterion, index), '', '']) },
        { type: 'foot', runs: '量规由 AI 起草的单元设计生成（kebiao.org），请结合学生作品修改后使用。' }
    ]
}

export function downloadRubricWord(plan) {
    return saveDocx(rubricBlocks(plan), `${plan.unit.performance_task.title}-评价量规`, FORM_PAGE)
}
