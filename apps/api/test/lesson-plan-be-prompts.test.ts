// AI 备课 prompts, checks and the 自查 (polish round, 11-08): which problems go back to the model, which fix is kept,
// where kebiao's 课堂学习目标 go, 体育 field lessons, 「双减」 homework, the alignment verdict, spoken scripts and caps.
//   npx tsx test/lesson-plan-be-prompts.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { FileCurriculumRepository } from '@curriculum/core'
import { createApp } from '../src/app.js'
import { checkPlan, checkPractice, classroomChecks, clip, fieldLesson, frameKeeps, frameProblems, practiceKeeps, processKeeps, processProblems, repairGroups, sanitiseProcess, speakable, talkMinutes, type DraftInput, type Frame, type PlanIndicator, type PlanStandard, type Process, type Stage } from '../src/lesson-plan.js'

const app = createApp(new FileCurriculumRepository(resolve(process.cwd(), '../../public/data')))
const json = async (response: Response) => JSON.parse(await response.text())
// the AI routes allow a few requests a minute from one address; these tests use their own
const IP = '203.0.113.77'

const LIMITED = 'MA-S3-NA-01.3'
const limitedText = '能用直观的方式表示分数和小数，能比较两个分数的大小和两个小数的大小；会进行小数和分数的转化（不包括将循环小数转化成分数）'
const indicators: PlanIndicator[] = [{ code: LIMITED, text: limitedText, pages: [31], standard_code: 'MA-S3-NA-01', standard_title: '数与运算', stage_label: '5–6 年级' }]

const frame = (overrides: Partial<Frame> = {}): Frame => ({
    title: '分数的基本性质',
    core_understanding: '分数的大小不变，分子分母可以同时变化',
    objectives: [
        { id: 'O1', text: '学生能借助折纸和画图，说出分数的基本性质', basis: [LIMITED], kind: '理解' },
        { id: 'O2', text: '学生能运用分数的基本性质，把分数化成指定分母的分数', basis: [LIMITED], kind: '能做' }
    ],
    key_points: ['理解分数的基本性质'],
    difficult_points: ['说清为什么 0 除外'],
    learner_analysis: '学生已经学过分数的意义。',
    prior_knowledge: ['分数的意义'],
    misconceptions: [],
    keywords: [],
    assessments: [{ id: 'A1', objective_ids: ['O1', 'O2'], task: '完成三道化分母的题并说理由', evidence: '学习单', criteria: '三题全对且能说理' }],
    ...overrides
})

const stage = (name: string, minutes: number, org = '全班', extra: Partial<Stage> = {}): Stage => ({ name, minutes, org, teacher: '…', students: '…', check: '巡视抽看', purpose: '', objective_ids: ['O1', 'O2'], assessment_ids: [], ...extra })
const plan = (overrides: Partial<Process> = {}): Process => ({
    stages: [stage('导入', 5), stage('探究', 15, '独立→同桌'), stage('练习', 20, '独立', { assessment_ids: ['A1'] })],
    homework: [{ level: '基础', task: '口头说说分数的基本性质', minutes: 5 }],
    board: ['分数的基本性质'],
    materials: [],
    safety: [],
    ...overrides
})

const input = (overrides: Partial<DraftInput> = {}): DraftInput => ({
    lesson: { title: '分数的基本性质', subject: '数学', subject_slug: 'math', grade: 5 },
    standards: [],
    indicators,
    subjectNote: null,
    periodMinutes: 40,
    lessonIndex: 1,
    lessonCount: 1,
    classNotes: '',
    teacherNotes: '',
    ...overrides
})

const reply = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 900, completion_tokens: 600, total_tokens: 1500 } }), { status: 200, headers: { 'content-type': 'application/json' } })
function withModel(t: { after: (fn: () => void) => void }) {
    const saved = process.env.KEBIAO_LLM_API_KEY
    process.env.KEBIAO_LLM_API_KEY = 'test-secret'
    t.after(() => { if (saved === undefined) delete process.env.KEBIAO_LLM_API_KEY; else process.env.KEBIAO_LLM_API_KEY = saved })
}
const draft = (body: unknown) => app.request('/api/v1/lesson-plans/draft', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': IP }, body: JSON.stringify(body) })

test('自查 fires on hard content rules only: long objectives, group work and 看全班 stay with the teacher', () => {
    const long = '学生能在折纸、画图和观察三组相等分数的活动中，用自己的话说出分数的分子和分母同时乘或除以相同的数（0 除外）分数大小不变的道理，并能举出两个例子加以说明，再用这个性质判断给出的四组分数是否相等并说明理由'
    assert.ok([...long].length > 80)
    const lengthy = frame({ objectives: [{ id: 'O1', text: long, basis: [LIMITED], kind: '理解' }] })
    assert.deepEqual(frameProblems(lengthy, input()), [])
    // the teacher still sees it, as a warning that leaves the verdict standing
    const checks = checkPlan(lengthy, null, input())
    assert.ok(checks.some(item => item.kind === 'objective_long' && item.level === 'warn'))
    assert.ok(checks.some(item => item.kind === 'aligned'))
    // no 依据 and the stamp go back
    assert.equal(frameProblems(frame({ objectives: [{ id: 'O1', text: '学生能说出分数的基本性质', basis: [], kind: '知道' }], assessments: [{ id: 'A1', objective_ids: ['O1'], task: '说一说', evidence: '', criteria: '' }] }), input()).length, 1)
    assert.equal(frameProblems(frame({ core_understanding: '本课完全符合新课标' }), input()).length, 1)

    const crowded = plan({ stages: [stage('讲解', 22), stage('小组一', 6, '四人小组', { check: '' }), stage('小组二', 6, '四人小组'), stage('小组三', 6, '四人小组', { assessment_ids: ['A1'] })] })
    const kinds = classroomChecks(crowded, 40, 5).map(item => item.kind)
    assert.ok(kinds.includes('group_work') && kinds.includes('class_check'))
    assert.deepEqual(processProblems(crowded, frame(), input()), [])
})

test('自查 homework: a little over the limit is advice, written work in grades 1–2 or far over goes back', () => {
    const over = (minutes: number) => plan({ homework: [{ level: '基础', task: '完成练习册第 12 页', minutes }] })
    assert.ok(classroomChecks(over(25), 40, 5).some(item => item.kind === 'homework_load'))
    assert.deepEqual(processProblems(over(25), frame(), input()), [])
    assert.equal(processProblems(over(35), frame(), input()).length, 1)
    assert.equal(processProblems(over(10), frame(), input({ lesson: { ...input().lesson, grade: 1 } })).length, 1)
    assert.equal(processProblems(plan({ homework: [{ level: '基础', task: '读给家长听，请家长签字', minutes: 5 }] }), frame(), input()).length, 1)
})

test('「双减」 homework: written work is found by its writing words, labels and 「不需要」 are not read as the task', () => {
    const load = (task: string, grade: number, minutes = 10) => classroomChecks(plan({ homework: [{ level: '基础', task, minutes }] }), 40, grade).filter(item => item.kind === 'homework_load')
    const parent = (task: string) => classroomChecks(plan({ homework: [{ level: '基础', task, minutes: 10 }] }), 40, 3).some(item => item.kind === 'homework_parent')
    // written, whatever oral words come with it (the audit's strings)
    assert.equal(load('回家请家长听写本课生字', 1).length, 1)
    assert.ok(parent('回家请家长听写本课生字'))
    assert.equal(load('抄写本课生字各三遍，并读给家长听', 2).length, 1)
    assert.equal(load('任选两行，在家描红并书写 g、k、h 各三次（口头练习）', 1).length, 1)
    assert.equal(load('完成课本第 30 页练习 1—4 题，并把错题讲给同桌听', 5, 25).length, 1)
    assert.equal(load('听写本单元词语，订正错字', 5, 25).length, 1)
    assert.equal(load('完成学案第 2 页，做完后读给家长听', 8, 40).length, 1)
    // oral, reading and hands-on work is not written: 做 in 「选做」「必做」 is a label, 「做一做」 is not writing
    assert.equal(load('选做：给家人讲一讲观潮的故事', 1).length, 0)
    assert.equal(load('口头作业（必做）：把课文读给家人听', 1).length, 0)
    assert.equal(load('在家做一做今天的折纸实验，观察影子的变化', 1).length, 0)
    assert.equal(load('背诵第二自然段', 2).length, 0)
    // an optional item by its label does not count towards the minutes
    assert.equal(load('选做：写一段观潮的话', 5, 25).length, 0)
    // what an item says is not needed is not asked of the parents
    assert.ok(!parent('读给家人听（不需要家长签名）'))
    assert.ok(!parent('自己订正错题，不用家长检查'))
})

test('a 自查 fix is kept only when it has fewer problems and loses nothing the first draft had', () => {
    const base = frame()
    assert.ok(frameKeeps(base, frame({ objectives: [base.objectives[0]], assessments: [{ ...base.assessments[0], objective_ids: ['O1'] }] }), input()))
    assert.ok(!frameKeeps(base, frame({ key_points: [] }), input()))
    assert.ok(!frameKeeps(base, frame({ learner_analysis: '' }), input()))
    // a split objective left without an assessment
    const split = frame({ objectives: [...base.objectives, { id: 'O3', text: '学生能说明为什么 0 除外', basis: [LIMITED], kind: '理解' }] })
    assert.ok(!frameKeeps(base, split, input()))
    // a fix that drops a stage, the homework or the board
    const first = plan()
    assert.ok(processKeeps(first, plan(), frame(), input()))
    assert.ok(!processKeeps(first, plan({ stages: first.stages.slice(0, 2) }), frame(), input()))
    assert.ok(!processKeeps(first, plan({ homework: [] }), frame(), input()))
    assert.ok(!processKeeps(first, plan({ board: [] }), frame(), input()))
    const items = (kinds: string[]) => ({ items: kinds.map(kind => ({ kind: kind as '练习' | '检测', level: '基础', question: 'q', answer: 'a', code: LIMITED, objective_id: 'O1' })) })
    assert.ok(practiceKeeps(items(['练习', '练习', '检测', '检测']), items(['练习', '练习', '练习', '检测'])))
    assert.ok(!practiceKeeps(items(['练习', '练习', '检测']), items(['练习', '练习', '练习'])))
    assert.ok(!practiceKeeps(items(['练习', '练习', '练习', '检测', '检测']), items(['练习', '检测'])))
})

test('自查 on the route: a fix that empties a part is not kept, nor one with as many problems', async t => {
    withModel(t)
    const ahead = frame({ objectives: [frame().objectives[0], { ...frame().objectives[1], text: '学生能用通分比较两个异分母分数的大小' }] })
    const request = { step: 'frame', lesson: { title: '分数的基本性质', subject_slug: 'math', grade: 5, edition_id: 'ed_1bb9d396d4d884aee79e', lesson_id: '9158d483-13f0-49b7-89ea-1aeddfb25f65' }, indicator_codes: [LIMITED] }
    for (const fix of [frame({ difficult_points: [] }), ahead]) {
        let calls = 0
        t.mock.method(globalThis, 'fetch', async () => reply(++calls === 1 ? ahead : fix))
        const data = (await json(await draft(request))).data
        assert.equal(calls, 2)
        assert.equal(data.self_check.kept, false)
        assert.ok(data.frame.difficult_points.length)
        assert.ok(data.frame.objectives.some((item: { text: string }) => item.text.includes('通分')))
    }
})

test('kebiao\'s 课堂学习目标 go to the frame, which writes the objectives, and not to the other steps', async t => {
    withModel(t)
    const prompts: Record<string, string> = {}
    t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body))
        const system = String(body.messages[0].content)
        const step = system.includes('教学设计（前半部分）') ? 'frame' : system.includes('写教学过程') ? 'process' : system.includes('练习题') ? 'practice' : 'reading'
        prompts[step] = String(body.messages.at(-1).content)
        return reply(step === 'process' ? plan() : step === 'practice' ? { items: [{ kind: '检测', level: '基础', question: '从上面看是什么形状？', answer: '正方形', code: 'MA-S3-GG-01.6', objective_id: 'O1' }] } : step === 'reading' ? { points: [] } : frame({ objectives: [{ id: 'O1', text: '学生能说出从上面看到的形状', basis: ['MA-S3-GG-01.6'], kind: '能做' }], assessments: [{ id: 'A1', objective_ids: ['O1'], task: '连线', evidence: '', criteria: '' }] }))
    })
    const request = { lesson: { title: '观察物体（三）', subject_slug: 'math', grade: 5, edition_id: 'ed_1bb9d396d4d884aee79e', lesson_id: '3e7ca3cb-0411-4dfe-aeb8-200ac1fedb84' }, indicator_codes: ['MA-S3-GG-01.6'] }
    const one = (await json(await draft({ ...request, step: 'frame' }))).data
    await draft({ ...request, step: 'reading' })
    await draft({ ...request, step: 'process', frame: one.frame })
    await draft({ ...request, step: 'practice', frame: one.frame })
    assert.match(prompts.frame, /kebiao 已为这一课写好的课堂学习目标[\s\S]*1\. 学生能在教师提供的物体模型或图示中/u)
    for (const step of ['process', 'practice', 'reading']) assert.ok(prompts[step] && !prompts[step].includes('kebiao 已为这一课写好的课堂学习目标'), step)
})

test('a 体育 lesson on the 操场 gets the field block and its load is checked; a 健康教育 lesson stays in the classroom', async t => {
    withModel(t)
    const prompts: string[] = []
    t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
        prompts.push(String(JSON.parse(String(init.body)).messages.at(-1).content))
        return reply(frame({ objectives: [{ id: 'O1', text: '学生能完成上挑式传接棒', basis: ['PE-S2-SS-02.1'], kind: '能做' }], assessments: [{ id: 'A1', objective_ids: ['O1'], task: '传接棒展示', evidence: '', criteria: '' }] }))
    })
    const lesson = { title: '上挑式、下压式传接棒', subject_slug: 'pe', grade: 4 }
    await draft({ step: 'frame', lesson, indicator_codes: ['PE-S2-SS-02.1'], class_notes: '在操场上课，接力棒 12 根。' })
    assert.match(prompts[0], /体育课，在操场或场馆上/u)
    assert.match(prompts[0], /群体运动密度应不低于 75%.*140～160 次\/分.*10 分钟左右的体能练习.*修订版 PDF 第 127 页/u)
    assert.ok(!prompts[0].includes('按排就座'))
    await draft({ step: 'frame', lesson: { ...lesson, title: '预防近视' }, indicator_codes: ['PE-S2-HE-01.1'] })
    assert.match(prompts[1], /按排就座/u)
    assert.match(prompts[1], /健康教育，在教室上/u)

    const pe = { lesson: { grade: 4, subject_slug: 'pe', title: '传接棒' }, indicators: [], standards: [] as PlanStandard[] }
    assert.ok(fieldLesson(pe))
    const seated = plan({ stages: [stage('复习', 5), stage('学习传接棒', 25, '四人小组', { students: '按前后桌4人一组，不搬桌，在学习单上画出交接动作' }), stage('小结', 10)] })
    const load = classroomChecks(seated, 40, 4, [], true).find(item => item.kind === 'pe_load')
    assert.ok(load && /准备部分.*体能.*结束部分/u.test(load.message) && load.message.includes('写成了在座位上做'))
    // a 40-minute field lesson over 25 minutes in one group stage is not a classroom group-work problem
    assert.ok(!classroomChecks(seated, 40, 4, [], true).some(item => item.kind === 'group_work' || item.kind === 'student_time'))
    const field = plan({ stages: [stage('准备部分：热身', 7), stage('基本部分：学练传接棒', 15, '四人小组'), stage('基本部分：体能练习', 10, '四人小组'), stage('结束部分：放松', 8)] })
    assert.deepEqual(classroomChecks(field, 40, 4, [], true).map(item => item.kind), [])
    // the load goes back to the model, and the plan is not called aligned while it is missing
    const peInput = input({ lesson: { title: '传接棒', subject: '体育与健康', subject_slug: 'pe', grade: 4 } })
    assert.ok(processProblems(seated, frame(), peInput).some(item => item.includes('体能')))
    assert.ok(!checkPlan(frame(), seated, peInput).some(item => item.kind === 'aligned'))
})

test('the alignment verdict says what was checked: the 超标 sentence only with a 课标 limit, after the process', () => {
    const verdict = (process: Process | null, picked = indicators) => checkPlan(frame(), process, { indicators: picked, standards: [], periodMinutes: 40 }).find(item => item.kind === 'aligned')?.message || ''
    assert.match(verdict(plan()), /教学环节和评价任务。对照课标写明的「不包括将循环小数转化成分数」，教案里没有发现超出的内容/u)
    assert.match(verdict(null), /依据和评价任务。课标写明的「不包括将循环小数转化成分数」，教学过程写完后再核/u)
    const plain = [{ ...indicators[0], text: '能比较两个分数的大小' }]
    assert.ok(!/超出|再核/u.test(verdict(plan(), plain)))
})

test('当堂练习 items on a later lesson or past a 课标 limit are named to the teacher', () => {
    const unitLessons = [{ title: '分数的基本性质', current: true }, { title: '约分' }, { title: '通分' }]
    const practice = { items: [
        { kind: '练习' as const, level: '基础', question: '把 2/3 化成分母是 12 的分数', answer: '8/12', code: LIMITED, objective_id: 'O2' },
        { kind: '检测' as const, level: '变式', question: '先通分，再比较 2/3 和 3/4 的大小', answer: '3/4 大', code: LIMITED, objective_id: 'O2' },
        { kind: '检测' as const, level: '提高', question: '把循环小数 0.333… 化成分数', answer: '1/3', code: LIMITED, objective_id: 'O1' }
    ] }
    const checks = checkPractice(practice, frame(), { indicators, standards: [], periodMinutes: 40, unitLessons })
    assert.ok(checks.some(item => item.kind === 'later_lesson' && item.message.includes('第 2 题') && item.message.includes('通分')))
    assert.ok(checks.some(item => item.kind === 'beyond_standard' && item.level === 'risk' && item.message.startsWith('当堂练习里')))
    // without the lesson's input only the coverage is checked, as before
    assert.deepEqual(checkPractice(practice, frame()).map(item => item.kind), [])
})

test('a 小组 stage over 8 minutes is cut in code: the rest goes to the next whole-class stage or a new 全班交流', () => {
    const merged = repairGroups([stage('导入', 5), stage('小组讨论', 14, '四人小组'), stage('全班汇报', 6), stage('练习', 15, '独立')])
    assert.deepEqual(merged.map(item => [item.name, item.minutes]), [['导入', 5], ['小组讨论', 8], ['全班汇报', 12], ['练习', 15]])
    const added = repairGroups([stage('导入', 5), stage('小组讨论', 14, '独立→四人小组'), stage('练习', 21, '独立')])
    assert.deepEqual(added.map(item => [item.name, item.minutes, item.org]), [['导入', 5, '全班'], ['小组讨论', 8, '独立→四人小组'], ['全班交流', 6, '全班'], ['练习', 21, '独立']])
    // a required experiment's stage may run 15 minutes
    const labs = [{ code: 'PH-S4-EX-01.1', text: '用托盘天平测量物体的质量', page: 31, source: '物理学生必做实验' }]
    assert.equal(repairGroups([stage('分组实验：测质量', 14, '四人小组', { students: '按步骤称量并记录' }), stage('小结', 26)], labs)[0].minutes, 14)
    assert.equal(classroomChecks(plan({ stages: added }), 40, 5).filter(item => item.kind === 'group_work').length, 0)
})

test('the process prompt gives each subject its own way through the lesson, not one math skeleton', async t => {
    withModel(t)
    const prompts: Record<string, string> = {}
    t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body))
        prompts.system = String(body.messages[0].content)
        prompts.user = String(body.messages.at(-1).content)
        return reply(plan())
    })
    const english = { step: 'process', lesson: { title: "Unit 3 A Let's talk", subject_slug: 'english', grade: 3 }, indicator_codes: ['EN-S1-LC-01.1'], frame: frame({ objectives: [{ id: 'O1', text: '学生能用 Hello 打招呼', basis: ['EN-S1-LC-01.1'], kind: '能做' }], assessments: [{ id: 'A1', objective_ids: ['O1'], task: '对话', evidence: '', criteria: '' }] }) }
    assert.equal((await draft(english)).status, 200)
    assert.ok(!prompts.system.includes('回顾检测（用前置知识出 2–3 个小问题）→ 情境与问题 → 先试'))
    assert.match(prompts.system, /不要每课都从回顾检测开始/u)
    assert.match(prompts.user, /学习理解.*应用实践.*迁移创新/u)
    assert.match(prompts.user, /新的语言、动作、技法先示范再模仿/u)
    assert.ok(!prompts.user.includes('数学：'))
    await draft({ step: 'process', lesson: { title: '分数的基本性质', subject_slug: 'math', grade: 5 }, indicator_codes: [LIMITED], frame: frame() })
    assert.match(prompts.user, /先试（独立想、同桌说）→ 讲解/u)
})

test('a 语文 lesson on a 学习任务群 要点 names its 任务群', async t => {
    withModel(t)
    const prompts: string[] = []
    t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
        prompts.push(String(JSON.parse(String(init.body)).messages.at(-1).content))
        return reply(frame({ objectives: [{ id: 'O1', text: '学生能讲述课文中的故事', basis: ['CN-S2-TG-03.1'], kind: '能做' }], assessments: [{ id: 'A1', objective_ids: ['O1'], task: '讲故事', evidence: '', criteria: '' }] }))
    })
    await draft({ step: 'frame', lesson: { title: '为中华之崛起而读书', subject_slug: 'chinese', grade: 4 }, indicator_codes: ['CN-S2-TG-03.1'] })
    assert.match(prompts[0], /本课所属的学习任务群：文学阅读与创意表达（CN-S2-TG-03）/u)
})

test('process: the board keeps what goes on the blackboard, an assessment named in a stage is placed, homework names its 要点', () => {
    const process = sanitiseProcess({
        stages: [{ name: '导入', minutes: 5, teacher: '出示问题', students: '思考', objective_ids: ['O1'] }, { name: '练习', minutes: 35, teacher: '组织学生完成 A1 学习单', students: '独立完成', objective_ids: ['O2'] }],
        homework: [{ level: '基础', task: '完成练习册第 3 页', minutes: 10, code: LIMITED, objective_id: 'O2' }, { level: '提高', task: '编一道题', code: 'MA-S9-XX-99.1', objective_id: 'O9' }],
        board: ['分数的基本性质', '分子分母同乘或同除以相同的数（0 除外），分数大小不变', '课堂任务：A1 学习单；A2 口头说理', 'A1：三道化分母的题', '作业：练习册第 3 页', '下节预告：约分', 'What\'s your name? Where are you from? How old are you? What is your favourite colour and why do you like it?']
    }, frame())!
    assert.deepEqual(process.stages[1].assessment_ids, ['A1'])
    assert.deepEqual(process.board.slice(0, 2), ['分数的基本性质', '分子分母同乘或同除以相同的数（0 除外），分数大小不变'])
    assert.equal(process.board.length, 3)
    // an English board line past the cap ends at a word, with 「…」
    assert.match(process.board[2], /colour and why do…$/u)
    assert.ok(process.board[2].length <= 100)
    assert.deepEqual(process.homework.map(item => [item.code, item.objective_id]), [[LIMITED, 'O2'], [undefined, undefined]])
})

test('a text over its cap ends at a word or clause break with 「…」, not mid-word', () => {
    assert.equal(clip('短句', 10), '短句')
    assert.equal(clip('We have to be quiet during tests. Because it helps everyone', 40), 'We have to be quiet during tests…')
    const chinese = clip('小组问卷设计与课堂微调查，推进目标二和目标四的口头表达', 20)
    assert.equal(chinese, '小组问卷设计与课堂微调查…')
    // a decimal point is not a break
    assert.ok(!clip('把循环小数 0.333333333333 化成分数', 14).endsWith('0…'))
})

test('说课稿 minutes come from its length, and spoken scripts do not read codes aloud', async t => {
    assert.equal(talkMinutes([{ text: '字'.repeat(2200) }, { text: '字'.repeat(440) }]), 12)
    assert.equal(talkMinutes([{ text: '短' }]), 1)
    const said = speakable(`本课依据课标要点 ${LIMITED}：会进行小数和分数的转化。目标二也对应 ${LIMITED}。`, indicators, 'cite')
    assert.equal((said.match(/MA-S3-NA-01\.3/gu) || []).length, 1)
    assert.match(said, /（MA-S3-NA-01\.3）/u)
    assert.match(said, /对应「能用直观的方式表示分数和小数…」/u)
    assert.ok(!speakable(`同学们，这节课我们落实课标 ${LIMITED} 的要求（${LIMITED}）。`, indicators, 'drop').includes('MA-S3'))
    // a code the model already put in brackets stays once
    assert.equal(speakable(`依据（${LIMITED}）……再看（${LIMITED}）。`, indicators, 'cite'), `依据（${LIMITED}）……再看。`)

    withModel(t)
    t.mock.method(globalThis, 'fetch', async () => reply({ sections: [
        { heading: '说教材', text: `本课依据 ${LIMITED}。${'说'.repeat(1200)}${LIMITED}` },
        { heading: '说学情', text: '学'.repeat(600) },
        { heading: '说教学目标与重难点', text: '目'.repeat(600) },
        { heading: '说教法与学法', text: '法'.repeat(300) },
        { heading: '说教学过程', text: '过'.repeat(2400) }
    ], minutes: 6 }))
    const response = await draft({ step: 'talk', lesson: { title: '分数的基本性质', subject_slug: 'math', grade: 5 }, indicator_codes: [LIMITED], frame: frame(), process: plan() })
    const { data } = await json(response)
    assert.equal((data.talk.sections[0].text.match(/MA-S3-NA-01\.3/gu) || []).length, 1)
    assert.ok(data.talk.sections[4].text.length <= 2000)
    const chars = data.talk.sections.reduce((sum: number, item: { text: string }) => sum + item.text.length, 0)
    assert.equal(data.talk.minutes, Math.round(chars / 220))
    assert.ok(data.talk.minutes > 6)
})
