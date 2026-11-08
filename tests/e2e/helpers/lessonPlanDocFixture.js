// A finished lesson plan as it is saved in this browser's history ('kebiao.lessonPlan.history'), so a spec can open
// the document without any AI call. Its AI text carries the model's own ids (O2, A2) the way live plans do.
const evidence = [{ code: 'MA-S3-NA-01.3', text: '能用直观的方式表示分数和小数，能比较两个分数的大小和两个小数的大小；会进行小数和分数的转化（不包括将循环小数转化成分数）。', pages: [31], standard_code: 'MA-S3-NA-01', standard_title: '数与运算（5–6 年级）', stage_label: '第三学段（5–6 年级）' }]

export const docPlan = {
    lesson: { title: '分数的基本性质', unit_title: '4 分数的意义和性质', textbook_title: '数学5年级下册', edition_id: 'ed_1bb9d396d4d884aee79e', edition_name: '人教版', lesson_id: 'L1', subject_slug: 'math', subject_name: '数学', grade: 5, pdf_page: 62 },
    evidence,
    frame: {
        title: '分数的基本性质（第 1 课时）',
        core_understanding: '分子分母同时乘或除以相同的数（0 除外），分数大小不变',
        objectives: [
            { id: 'O1', text: '学生能借助折纸说出分数的基本性质并解释理由', basis: ['MA-S3-NA-01.3'], kind: '理解' },
            { id: 'O2', text: '学生能运用分数的基本性质把分数化成指定分母的分数', basis: ['MA-S3-NA-01.3'], kind: '运用' }
        ],
        key_points: ['理解分数的基本性质'],
        difficult_points: ['理解「0 除外」'],
        strategies: ['用折纸和画图对照，先看后说'],
        learner_analysis: '学生已学过分数的意义，会用画图表示分数。',
        prior_knowledge: ['分数的意义'],
        misconceptions: [{ text: '分子分母同时加相同的数大小不变', response: '画图反例' }],
        keywords: [],
        assessments: [
            { id: 'A1', objective_ids: ['O1'], task: '用折纸说明 1/2=2/4', evidence: '折纸作品和口头说明', criteria: '能说出分子分母同乘 2' },
            { id: 'A2', objective_ids: ['O2'], task: '把 3 个分数化成分母是 12 的分数', evidence: '学习单', criteria: '3 题至少对 2 题' }
        ]
    },
    process: {
        stages: [
            { name: '情境导入', minutes: 5, org: '全班', teacher: '出示三张同样大的纸', students: '观察涂色部分', purpose: '引出问题', objective_ids: [], assessment_ids: [] },
            { name: '折纸探究', minutes: 20, org: '独立→同桌', teacher: '组织折纸', students: '折纸并记录', questions: [{ q: '1/2 和 2/4 哪个大？', expect: '一样大；有人说 2/4 大', follow: '折一折看看' }], check: '举手势表决', support: '慢的同学看例图对照', purpose: '完成O1与评价任务（A1）', objective_ids: ['O1'], assessment_ids: ['A1'] },
            { name: '练习运用', minutes: 12, org: '独立', teacher: '巡视', students: '完成学习单', check: '同桌互查', purpose: '完成O2并为A2准备作业', objective_ids: ['O2'], assessment_ids: ['A2'] },
            { name: '小结', minutes: 3, org: '全班', teacher: '引导小结', students: '说一说', purpose: '梳理', objective_ids: ['O1', 'O2'], assessment_ids: [] }
        ],
        homework: [{ level: '基础', task: '在家完成分数改写表（A2），用A4纸画图', minutes: 10 }],
        board: ['分数的基本性质', '课堂作业：完成分数改写表（A2）'],
        materials: ['正方形纸'],
        safety: []
    },
    practice: { items: [
        { kind: '练习', level: '基础', question: '把 2/3 化成分母是 12 的分数。', answer: '8/12', code: 'MA-S3-NA-01.3', objective_id: 'O2' },
        { kind: '检测', level: '变式', question: '3/4 和 9/12 相等吗？说明理由。', answer: '相等，分子分母同乘 3', code: 'MA-S3-NA-01.3', objective_id: 'O1' }
    ] },
    reading: {
        step: 'reading',
        reading: { points: [{ code: 'MA-S3-NA-01.3', plain: '会比较分数大小，会进行分数和小数的转化', verbs: [{ word: '比较', meaning: '能说明理由地比较两个分数的大小' }], this_lesson: '本课讲分数的基本性质', textbook: '用教材的折纸活动发现规律', avoid: '不讲循环小数化分数' }], position: '承接分数的意义', literacy: [] },
        links: [{ code: 'MA-S3-NA-01.3', before: [], after: [], in_book: [{ unit: '4 分数的意义和性质', lesson: '分数的基本性质', page: 62, current: true }], books: 1 }],
        standards: [{ code: 'MA-S3-NA-01', title: '数与运算（5–6 年级）', stage_label: '第三学段（5–6 年级）', statement: '', statement_source: '', requirements: ['能比较两个分数的大小。'], guidance: ['注重数的意义。'] }],
        limits: ['不包括将循环小数转化成分数']
    },
    checks: [
        { level: 'ok', kind: 'aligned', message: '每条目标都有课标要点依据、教学环节和评价任务。' },
        { level: 'warn', kind: 'practice_time', message: '当堂练习的用时加起来超过了检测环节的时间。' }
    ],
    meta: { period_minutes: 40, lesson_index: 1, lesson_count: 1, class_size: 45, lesson_type: '新授课' },
    model: 'gpt-5-mini',
    created_at: '2026-11-08T08:00:00.000Z'
}

export const talkDraft = { step: 'talk', talk: { sections: [{ heading: '说教材', text: '本课依据 MA-S3-NA-01.3。' }, { heading: '说教学过程', text: '先折纸，再练习。' }], minutes: 6 }, evidence, model: 'gpt-5-mini' }

export const trialDraft = { step: 'trial', trial: { stages: [{ name: '导入', minutes: 1, text: '同学们，这三张纸的涂色部分一样大吗？（模拟学生回答：一样大。）' }], board: ['分数的基本性质'], defense: [{ question: '本课目标的课标依据是什么？', answer: '依据 MA-S3-NA-01.3。' }], minutes: 9 }, evidence, model: 'gpt-5-mini' }

// open the saved plan from 最近的草稿 on the empty page
export async function openSavedPlan(page, plan = docPlan) {
    await page.addInitScript(value => { window.localStorage.setItem('kebiao.lessonPlan.history', value) }, JSON.stringify([plan]))
    await page.goto('/lesson-plan')
    await page.getByRole('button', { name: new RegExp(plan.frame.title.slice(0, 6)) }).click()
    await page.getByRole('heading', { name: plan.frame.title }).waitFor()
}
