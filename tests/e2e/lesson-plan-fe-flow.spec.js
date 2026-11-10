import { expect, test } from '@playwright/test'

// AI 备课 page flow: what happens around a draft (lesson changes, the AI pick, history, copying, errors).
// Every /api/v1/lesson-plans call is mocked.

const envelope = data => ({ data, meta: { request_id: 'e2e', data_version: 'e2e', schema_version: '1.0.0', warnings: [] } })
const json = data => ({ contentType: 'application/json', body: JSON.stringify(envelope(data)) })
const EDITION = 'ed_1bb9d396d4d884aee79e'
const MATH = encodeURIComponent('数学')

const lesson = { title: '分数的基本性质', unit_title: '4 分数的意义和性质', textbook_title: '数学5年级下册', edition_id: EDITION, edition_name: '人教版', unit_id: null, lesson_id: 'L1', subject_slug: 'math', grade: 5, pdf_page: 62, printed_page: '' }
const indicator = (code, text, page = 31) => ({ code, text, pages: [page] })
const standard = (code, title, indicators) => ({ code, title, subject: '数学', subject_slug: 'math', stage_label: '第三学段（5–6 年级）', level1: '数与代数', level2: '数与运算', statement: '', statement_source: '', via: 'aligned', suggested: [], requirements: [], guidance: [], examples: [], indicators })
const standards = [
    standard('MA-S3-NA-02', '数量关系（5–6 年级）', [indicator('MA-S3-NA-02.1', '能在具体问题中感受等式的基本性质。', 32)]),
    standard('MA-S3-NA-01', '数与运算（5–6 年级）', [indicator('MA-S3-NA-01.3', '能用直观的方式表示分数和小数，能比较两个分数的大小。')])
]
const contextOf = (overrides = {}) => ({
    lesson,
    standards,
    subject_note: { name: '数学' },
    national_lessons: [],
    national_confidence: 'text',
    ...overrides
})
const lessons = { platform_title: '小学数学人教版五年级下册', confidence: 'text', lessons: [
    { id: 'L1', title: '分数的基本性质', chapters: ['4 分数的意义和性质'], pdf_page: 62, materials: [], url: '' },
    { id: 'L2', title: '约分', chapters: ['4 分数的意义和性质'], pdf_page: 70, materials: [], url: '' }
] }
const frame = {
    title: '分数的基本性质',
    core_understanding: '分子分母同时乘或除以相同的数（0 除外），分数大小不变',
    objectives: [{ id: 'O1', text: '学生能借助折纸说出分数的基本性质并解释理由', basis: ['MA-S3-NA-01.3'], kind: '理解' }],
    key_points: ['理解分数的基本性质'],
    difficult_points: ['理解 0 除外'],
    learner_analysis: '学生已学过分数的意义。',
    prior_knowledge: [],
    misconceptions: [],
    keywords: [],
    assessments: [{ id: 'A1', objective_ids: ['O1'], task: '用折纸说明 1/2=2/4', evidence: '折纸作品', criteria: '能说出理由' }]
}
const processDraft = {
    stages: [{ name: '折纸探究', minutes: 40, org: '独立→同桌', teacher: '组织折纸', students: '折纸并记录', questions: [], check: '举手势表决', purpose: '发现规律', objective_ids: ['O1'], assessment_ids: ['A1'] }],
    homework: [{ level: '基础', task: '课本练习', minutes: 10 }],
    board: ['分数的基本性质'],
    materials: [],
    safety: []
}
const evidence = [{ code: 'MA-S3-NA-01.3', text: standards[1].indicators[0].text, pages: [31], standard_code: 'MA-S3-NA-01', standard_title: '数与运算（5–6 年级）', stage_label: '第三学段（5–6 年级）' }]
const pickOk = { status: 'ok', read: 9, picks: [{ code: 'MA-S3-NA-01', grade: 2, reason: '比较分数大小', point: 'MA-S3-NA-01.3' }] }
const talk = { sections: [{ heading: '说教材', text: '本课是本单元的第二课时。' }], minutes: 6 }

function draftAnswer(body) {
    if (body.step === 'frame') return { step: 'frame', frame, checks: [], evidence, privacy: { redacted: false }, model: 'gpt-5-mini' }
    if (body.step === 'reading') return { step: 'reading', reading: null, links: [], standards: [], limits: [], evidence, model: 'gpt-5-mini' }
    if (body.step === 'practice') return { step: 'practice', practice: { items: [{ kind: '练习', level: '基础', question: '把 2/3 化成分母是 12 的分数。', answer: '8/12', code: 'MA-S3-NA-01.3', objective_id: 'O1' }] }, checks: [], model: 'gpt-5-mini' }
    if (body.step === 'talk') return { step: 'talk', talk, evidence, model: 'gpt-5-mini' }
    return { step: 'process', frame, process: processDraft, checks: [{ level: 'ok', kind: 'aligned', message: '每条目标都有课标要点依据。' }], evidence, privacy: { redacted: false }, model: 'gpt-5-mini' }
}

async function mockLessonPlans(page, { context = () => contextOf(), pick = () => pickOk, draft = draftAnswer } = {}) {
    const calls = { context: [], pick: [], draft: [] }
    await page.route('**/api/v1/lesson-plans/textbooks/*/lessons', route => route.fulfill(json(lessons)))
    await page.route('**/api/v1/lesson-plans/context?*', route => {
        const query = new URL(route.request().url()).searchParams
        calls.context.push(query)
        return route.fulfill(json(context(query)))
    })
    await page.route('**/api/v1/lesson-plans/pick', async route => {
        calls.pick.push(route.request().postDataJSON())
        const answer = await pick(route)
        // a pick the page cancelled meanwhile cannot be answered
        if (answer) await route.fulfill(json(answer)).catch(() => {})
    })
    await page.route('**/api/v1/lesson-plans/draft', async route => {
        const body = route.request().postDataJSON()
        calls.draft.push(body)
        const answer = await draft(body, route)
        if (answer) return route.fulfill(json(answer))
        return undefined
    })
    return calls
}

const draftButton = page => page.getByRole('button', { name: /起草教案|重新起草|最多 12 条|等 kebiao 找完要点/ })

test('picking another lesson puts the finished plan away; the next lesson starts clean', async ({ page }) => {
    const calls = await mockLessonPlans(page, {
        context: query => (query.get('lesson_id') === 'L2' ? contextOf({ lesson: { ...lesson, title: '约分', lesson_id: 'L2' } }) : contextOf())
    })
    await page.goto(`/lesson-plan?subject=${MATH}&edition=${EDITION}&lesson=L1`)
    await expect(page.getByRole('checkbox', { name: /能用直观的方式表示分数和小数/ })).toBeChecked()
    await page.getByRole('button', { name: /按选定的 1 条要点起草教案/ }).click()
    await expect(page.getByRole('heading', { name: '七、教学过程' })).toBeVisible()
    // the finished plan takes focus; drafting again is the secondary action and says it replaces the plan
    await expect(page.locator('#lp-doc-title')).toBeFocused()
    await expect(page.getByRole('status').filter({ hasText: '教案写好了' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: '重新起草（会替换下面的教案）' })).toHaveClass(/btn-secondary/u)

    await page.getByRole('combobox', { name: '哪一课' }).selectOption('L2')
    await expect(page.locator('section[aria-labelledby="lp-basis"]').getByRole('paragraph').filter({ hasText: /^约分$/u })).toBeVisible()
    await expect(page.getByRole('heading', { name: '七、教学过程' })).toHaveCount(0)
    await expect(page.locator('#lp-doc-title')).toHaveCount(0)
    await expect(page.locator('ol li[data-state]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /按选定的 1 条要点起草教案/ })).toBeEnabled()
    // the plan is not lost: it is in 最近的草稿
    await expect(page.getByRole('button', { name: /分数的基本性质.*数学 · 5 年级/ })).toBeVisible()
    expect(calls.context.at(-1).get('lesson_id')).toBe('L2')
})

test('the AI pick keeps the 要点 the teacher ticked while it ran, and drafting waits for it', async ({ page }) => {
    let release
    const answered = new Promise(resolve => { release = resolve })
    await mockLessonPlans(page, { pick: async () => { await answered; return pickOk } })
    await page.goto(`/lesson-plan?subject=${MATH}&edition=${EDITION}&lesson=L1`)
    await expect(page.getByText(/AI 正在把这个年级的课标逐条读一遍/)).toBeVisible()
    await expect(draftButton(page)).toBeDisabled()
    await expect(draftButton(page)).toHaveText('等 kebiao 找完要点…')
    await page.getByRole('checkbox', { name: /等式的基本性质/ }).check()
    release()
    await expect(page.getByText(/AI 读完了，已勾选/)).toBeVisible()
    await expect(page.getByRole('checkbox', { name: /能用直观的方式表示分数和小数/ })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: /等式的基本性质/ })).toBeChecked()
    await expect(page.getByRole('button', { name: /按选定的 2 条要点起草教案/ })).toBeEnabled()
})

test('a pick still running when the teacher moves to another lesson is cancelled', async ({ page }) => {
    let first = true
    const calls = await mockLessonPlans(page, {
        context: query => (query.get('lesson_id') === 'L2' ? contextOf({ lesson: { ...lesson, title: '约分', lesson_id: 'L2' } }) : contextOf()),
        // the first pick never answers by itself
        pick: async () => {
            if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 1500)); return { status: 'ok', read: 9, picks: [{ code: 'MA-S3-NA-02', grade: 2, reason: '旧的', point: 'MA-S3-NA-02.1' }] } }
            return pickOk
        }
    })
    const aborted = []
    page.on('requestfailed', request => { if (request.url().includes('/pick')) aborted.push(request.failure()?.errorText) })
    await page.goto(`/lesson-plan?subject=${MATH}&edition=${EDITION}&lesson=L1`)
    await expect(page.getByText(/AI 正在把这个年级的课标逐条读一遍/)).toBeVisible()
    await page.getByRole('combobox', { name: '哪一课' }).selectOption('L2')
    await expect(page.getByText(/AI 读完了，已勾选/)).toBeVisible()
    await expect.poll(() => aborted.length).toBe(1)
    await page.waitForTimeout(2000)
    // the stale answer did not land on the new lesson
    await expect(page.getByRole('checkbox', { name: /等式的基本性质/ })).not.toBeChecked()
    expect(calls.pick).toHaveLength(2)
})

test.describe('a crawler', () => {
    test.use({ userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' })
    test('waits for 「让 kebiao 找要点」 instead of starting the AI pick', async ({ page }) => {
    const calls = await mockLessonPlans(page)
    await page.goto(`/lesson-plan?subject=${MATH}&edition=${EDITION}&lesson=L1`)
    await expect(page.getByRole('button', { name: '让 kebiao 找要点' })).toBeVisible()
    await page.waitForTimeout(500)
    expect(calls.pick).toHaveLength(0)
    await page.getByRole('button', { name: '让 kebiao 找要点' }).click()
    await expect(page.getByText(/AI 读完了，已勾选/)).toBeVisible()
    expect(calls.pick).toHaveLength(1)
    })
})

test('直接写课题 needs a 年级 before 找课标; changing 学科 or 年级 does not send the old topic again', async ({ page }) => {
    const calls = await mockLessonPlans(page, { context: () => contextOf({ lesson: { ...lesson, edition_id: null, lesson_id: null, textbook_title: '', edition_name: '' } }) })
    await page.goto(`/lesson-plan?mode=topic&subject=${MATH}`)
    await expect(page.getByRole('button', { name: '直接写课题' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByPlaceholder(/分数的基本性质、浮力/).fill('分数的基本性质')
    await expect(page.getByRole('button', { name: '找课标' })).toBeDisabled()
    await page.getByRole('combobox', { name: '年级（必选）' }).selectOption('5')
    await page.getByRole('button', { name: '找课标' }).click()
    await expect(page.getByRole('heading', { name: /确认依据/ })).toBeVisible()
    expect(calls.context.at(-1).get('grade')).toBe('5')
    const before = calls.context.length
    await page.getByRole('combobox', { name: '年级（必选）' }).selectOption('6')
    await expect(page.getByRole('heading', { name: /确认依据/ })).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(calls.context.length).toBe(before)
    // the typed words stay; one click asks again at the new grade
    await expect(page.getByPlaceholder(/分数的基本性质、浮力/)).toHaveValue('分数的基本性质')
    await page.getByRole('button', { name: '找课标' }).click()
    await expect.poll(() => calls.context.at(-1).get('grade')).toBe('6')
})

test('more 要点 than a lesson can take: the button says how many to remove', async ({ page }) => {
    const many = standard('MA-S3-NA-09', '很多要点', Array.from({ length: 13 }, (_, k) => indicator(`MA-S3-NA-09.${k + 1}`, `第 ${k + 1} 条要点`)))
    await mockLessonPlans(page, {
        context: () => contextOf({ standards: [many] }),
        pick: () => ({ status: 'ok', read: 9, picks: [{ code: 'MA-S3-NA-09', grade: 2, reason: '多', point: 'MA-S3-NA-09.1' }] })
    })
    await page.goto(`/lesson-plan?subject=${MATH}&edition=${EDITION}&lesson=L1`)
    await expect(page.getByText(/AI 读完了，已勾选/)).toBeVisible()
    for (let k = 2; k <= 13; k += 1) await page.getByRole('checkbox', { name: new RegExp(`第 ${k} 条要点`, 'u') }).check()
    await expect(draftButton(page)).toHaveText('已选 13 条要点，最多 12 条：请去掉 1 条')
    await expect(draftButton(page)).toBeDisabled()
    await page.getByRole('checkbox', { name: /第 13 条要点/ }).uncheck()
    await expect(page.getByRole('button', { name: /按选定的 12 条要点起草教案/ })).toBeEnabled()
})

test('a dropped first call says to try again; 继续写 is offered only once a part is saved', async ({ page }) => {
    let frames = 0
    await mockLessonPlans(page, {
        draft: (body, route) => {
            if (body.step === 'frame') {
                frames += 1
                if (frames === 1) return route.abort('failed').then(() => null)
            }
            return draftAnswer(body)
        }
    })
    await page.goto(`/lesson-plan?subject=${MATH}&edition=${EDITION}&lesson=L1`)
    await expect(page.getByText(/AI 读完了，已勾选/)).toBeVisible()
    await page.getByRole('button', { name: /按选定的 1 条要点起草教案/ }).click()
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('网络连接中断了')
    await expect(alert).toContainText('再试一次')
    await expect(alert).not.toContainText('继续写')
    await expect(page.getByRole('button', { name: /继续写/ })).toHaveCount(0)
    const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem('kebiao.lessonPlan.history') || '[]'))
    expect(saved).toHaveLength(0)
})

test('a 说课稿 is saved with its plan, comes back with it, errors show by the plan, and a draft can be deleted', async ({ page }) => {
    let talks = 0
    const calls = await mockLessonPlans(page, {
        draft: async (body, route) => {
            // the first 说课稿 hits the rate limit
            if (body.step === 'talk' && (talks += 1) === 1) {
                await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'rate_limit_exceeded', message: '当前 anonymous 访问层级已超过速率限制，请稍后重试。', details: [] } }) })
                return null
            }
            return draftAnswer(body)
        }
    })
    await page.goto(`/lesson-plan?subject=${MATH}&edition=${EDITION}&lesson=L1`)
    await expect(page.getByText(/AI 读完了，已勾选/)).toBeVisible()
    await page.getByRole('button', { name: /按选定的 1 条要点起草教案/ }).click()
    // 说课稿 sits under 更多
    await page.locator('summary', { hasText: '更多' }).click()
    await expect(page.getByRole('button', { name: '生成说课稿' })).toBeVisible()
    await page.getByRole('button', { name: '生成说课稿' }).click()
    await expect(page.getByRole('alert')).toContainText('说课稿没写出来')
    await expect(page.getByRole('alert')).toContainText('一分钟后再试')
    await expect(page.getByRole('alert')).not.toContainText('anonymous')
    await page.getByRole('button', { name: '生成说课稿' }).click()
    await expect(page.getByRole('heading', { name: '《分数的基本性质》说课稿' })).toBeVisible()
    await expect(page.locator('#lp-talk-title')).toBeFocused()
    // the script request says where the lesson sits
    const talkRequest = calls.draft.filter(item => item.step === 'talk').at(-1)
    expect(talkRequest).toMatchObject({ lesson_index: 1, lesson_count: 1, class_size: 45 })

    await page.goto('/lesson-plan?mode=topic')
    const restore = page.getByRole('button', { name: /分数的基本性质（含说课稿）/ })
    await expect(restore).toBeVisible()
    await restore.click()
    await expect(page.locator('#lp-doc-title')).toBeFocused()
    await expect(page.getByRole('heading', { name: '《分数的基本性质》说课稿' })).toBeVisible()
    // the list stays, folded, and a draft can be removed
    await page.getByText(/最近的草稿/).click()
    await page.getByRole('button', { name: '删除', exact: true }).click()
    await expect(restore).toHaveCount(0)
    const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem('kebiao.lessonPlan.history') || '[]'))
    expect(saved).toHaveLength(0)
})

test('history lists up to 10 drafts and skips a broken one', async ({ page }) => {
    const drafts = Array.from({ length: 10 }, (_, k) => ({ lesson: { ...lesson, title: `第 ${k + 1} 课`, subject_name: '数学' }, frame: { ...frame, title: `第 ${k + 1} 课` }, process: processDraft, evidence, checks: [], meta: { period_minutes: 40, lesson_index: 1, lesson_count: 1 }, created_at: `2026-10-${String(k + 10).padStart(2, '0')}T08:00:00.000Z` }))
    await page.addInitScript(value => { if (!window.sessionStorage.getItem('seeded')) { window.localStorage.setItem('kebiao.lessonPlan.history', JSON.stringify(value)); window.sessionStorage.setItem('seeded', '1') } }, [{ lesson: { title: '坏的' }, frame: { objectives: 'x' } }, ...drafts])
    await mockLessonPlans(page)
    await page.goto('/lesson-plan?mode=topic')
    await expect(page.getByRole('button', { name: /^第 \d+ 课/u })).toHaveCount(10)
    await expect(page.getByRole('button', { name: /坏的/ })).toHaveCount(0)
})

test('where the clipboard is refused, the text is shown selected to copy by hand; the prompt carries the teacher\'s notes', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true })
        document.execCommand = () => false
    })
    await mockLessonPlans(page, { context: () => contextOf({ lesson_goals: { take: '', later: '', items: [['学生能说出分数的基本性质', ['MA-S3-NA-01.3'], '比较两个分数的大小', '']] } }) })
    await page.goto(`/lesson-plan?subject=${MATH}&edition=${EDITION}&lesson=L1`)
    await expect(page.getByText(/AI 读完了，已勾选/)).toBeVisible()
    await page.getByPlaceholder(/班级整体情况/).fill('学生会画图表示分数')
    await page.getByPlaceholder(/想用折纸活动导入/).fill('想用折纸导入')
    await page.getByRole('combobox', { name: '课型' }).selectOption('新授课')
    await page.getByRole('button', { name: '复制成提示词' }).click()
    const box = page.getByRole('dialog', { name: '手动复制' })
    await expect(box.getByRole('alert')).toContainText('长按')
    const text = box.getByRole('textbox', { name: '要复制的文字' })
    await expect(text).toBeFocused()
    const value = await text.inputValue()
    for (const part of ['班级情况：学生会画图表示分数', '老师的想法：想用折纸导入', '课型：新授课', '这是第 1 课时', 'kebiao 已为这一课写好的课堂学习目标', '学生能说出分数的基本性质（依据 MA-S3-NA-01.3）']) expect(value).toContain(part)
    expect(await text.evaluate(element => element.selectionEnd - element.selectionStart)).toBe(value.length)
    await box.getByRole('button', { name: '关闭' }).click()
    await expect(box).toHaveCount(0)
})

test.describe('WeChat\'s browser', () => {
    test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50' })
    test('is told how to get the plan out', async ({ page }) => {
    await page.addInitScript(value => window.localStorage.setItem('kebiao.lessonPlan.history', JSON.stringify(value)), [{ lesson: { ...lesson, subject_name: '数学' }, frame, process: processDraft, evidence, checks: [], meta: { period_minutes: 40, lesson_index: 1, lesson_count: 1 }, created_at: '2026-10-20T08:00:00.000Z' }])
    await mockLessonPlans(page)
    await page.goto('/lesson-plan?mode=topic')
    await page.getByRole('button', { name: /分数的基本性质.*10 月 20 日/ }).click()
    await expect(page.getByText('微信里不能直接下载：点右上角「···」选「在浏览器打开」，或用「复制全文」')).toBeVisible()
    })
})

test('我的书 pointing at a lesson the reprint renamed opens the lesson with the same title', async ({ page }) => {
    await page.addInitScript(edition => { if (!window.sessionStorage.getItem('seeded')) { window.localStorage.setItem('kebiao.lessonPlan.lastBook', JSON.stringify({ subject: '数学', edition, lesson: { id: 'OLD', title: '约分' } })); window.sessionStorage.setItem('seeded', '1') } }, EDITION)
    const calls = await mockLessonPlans(page)
    await page.route('**/api/v1/lesson-plans/context?*', route => {
        const query = new URL(route.request().url()).searchParams
        calls.context.push(query)
        if (query.get('lesson_id') === 'OLD') return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: '未找到这一课。', details: [] } }) })
        return route.fulfill(json(contextOf({ lesson: { ...lesson, title: '约分', lesson_id: query.get('lesson_id') } })))
    })
    await page.goto(`/lesson-plan?subject=${MATH}&edition=${EDITION}&lesson=OLD`)
    await expect(page).toHaveURL(/lesson=L2/u)
    await expect(page.getByText('未找到这一课。')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /确认依据/ })).toBeVisible()

    // no lesson of that title: the stale lesson is forgotten, with a line saying why
    await page.evaluate(edition => window.localStorage.setItem('kebiao.lessonPlan.lastBook', JSON.stringify({ subject: '数学', edition, lesson: { id: 'GONE', title: '没有这课' } })), EDITION)
    await page.goto(`/lesson-plan?subject=${MATH}&edition=${EDITION}&lesson=GONE`)
    await expect(page.getByText(/这本书里没有找到上次那一课/)).toBeVisible()
    await expect(page).not.toHaveURL(/lesson=/u)
    await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem('kebiao.lessonPlan.lastBook')).lesson)).toBeUndefined()
})

test('a textbook unit page opens 备课助手 on its 国家平台 lesson, and no longer offers a 测试卷 check', async ({ page }) => {
    await page.route('**/api/v1/units/tcu_d2e3a59e5cc5f759', route => route.fulfill(json({ entry_id: 'tcu_d2e3a59e5cc5f759', edition_id: EDITION, title: '观察物体（三）', textbook_title: '数学5年级下册', subject: '数学', subject_slug: 'math', grade: 5, volume: '下册', pdf_page: 8, printed_page: '2', alignments: [], related_resources: [] })))
    await page.route('**/api/v1/lesson-plans/context?*', route => route.fulfill(json(contextOf({ lesson_id: null, national_lessons: [{ id: '3e7ca3cb-0411-4dfe-aeb8-200ac1fedb84', title: '观察物体（三）', chapters: ['1 观察物体（三）'], pdf_page: 8, unit_id: 'tcu_d2e3a59e5cc5f759', materials: [], hours: 1, url: 'https://basic.smartedu.cn/x' }] }))))
    await page.goto('/textbook-units/tcu_d2e3a59e5cc5f759')
    await expect(page.getByRole('link', { name: /用备课助手起草这一课的教案/ })).toHaveAttribute('href', /lesson=3e7ca3cb-0411-4dfe-aeb8-200ac1fedb84/u)
    await expect(page.getByRole('link', { name: /单元整体设计/ })).toHaveAttribute('href', /chapter=/u)
    await expect(page.getByRole('link', { name: '核验这个单元的测试卷' })).toHaveCount(0)
})

test('a unit design still drafting locks the lesson; one that returns after the lesson changed is dropped', async ({ page }) => {
    const unitContext = contextOf({ lesson: { ...lesson, title: '分数的意义和性质', lesson_id: null }, unit_lessons: [{ id: 'L1', title: '分数的基本性质', section: null, pdf_page: 62, hours: 2 }, { id: 'L2', title: '约分', section: null, pdf_page: 70, hours: 2 }] })
    const unit = {
        title: '旧单元设计', big_idea: '同一个数可以有多种等值的分数表示', essential_questions: ['什么时候两个分数一样大？'],
        objectives: [{ id: 'O1', text: '学生能说明分数的意义', basis: ['MA-S3-NA-01.3'], kind: '理解' }],
        performance_task: { title: '班级分饼会', scenario: '设计公平分配方案', product: '方案', criteria: ['用分数表示'] },
        assessments: [{ id: 'A1', objective_ids: ['O1'], task: '分配方案', evidence: '方案', criteria: '正确' }],
        lessons: [{ title: '分数的基本性质', hours: 2, focus: '等值分数', objective_ids: ['O1'], assessment_ids: ['A1'] }, { title: '约分', hours: 2, focus: '约分', objective_ids: ['O1'], assessment_ids: [] }],
        prior_knowledge: [], connections: ''
    }
    let release
    const held = new Promise(resolve => { release = resolve })
    const drafts = [{ lesson: { ...lesson, subject_name: '数学' }, frame, process: processDraft, evidence, checks: [], meta: { period_minutes: 40, lesson_index: 1, lesson_count: 1 }, created_at: '2026-10-10T08:00:00.000Z' }]
    await page.addInitScript(value => { if (!window.sessionStorage.getItem('seeded')) { window.localStorage.setItem('kebiao.lessonPlan.history', JSON.stringify(value)); window.sessionStorage.setItem('seeded', '1') } }, drafts)
    await mockLessonPlans(page, {
        context: query => (query.get('chapter') ? unitContext : contextOf()),
        draft: async body => {
            if (body.step !== 'unit') return draftAnswer(body)
            await held
            return { step: 'unit', unit, checks: [], evidence, privacy: { redacted: false }, model: 'gpt-5-mini' }
        }
    })
    // the lesson first, then the unit as a new history entry, so 「后退」 goes back to the lesson in the page
    await page.goto(`/lesson-plan?subject=${MATH}&edition=${EDITION}&lesson=L1`)
    await expect(page.getByRole('checkbox', { name: /能用直观的方式表示分数和小数/ })).toBeChecked()
    await page.evaluate(url => { window.history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')) }, `/lesson-plan?subject=${MATH}&edition=${EDITION}&chapter=${encodeURIComponent('4 分数的意义和性质')}`)
    await page.getByRole('button', { name: /按选定的 1 条要点起草单元设计/ }).click()
    await expect(page.getByRole('button', { name: /AI 正在做单元设计/ })).toBeDisabled()
    // nothing that changes the lesson can be used while the unit design is drafting
    await expect(page.getByRole('combobox', { name: '哪一课' })).toBeDisabled()
    await expect(page.getByRole('combobox', { name: '教材' })).toBeDisabled()
    await expect(page.getByRole('combobox', { name: '学科' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '直接写课题' })).toBeDisabled()
    await expect(page.getByRole('button', { name: /分数的基本性质.*数学 · 5 年级/ })).toBeDisabled()
    await expect(page.getByRole('button', { name: '删除' })).toBeDisabled()

    // the browser's back button still changes the lesson; the unit design that comes back afterwards is dropped
    await page.goBack()
    await expect(page.getByRole('button', { name: /按选定的 1 条要点起草教案/ })).toBeVisible()
    const answered = page.waitForResponse(response => response.url().includes('/lesson-plans/draft'))
    release()
    await answered
    await page.waitForTimeout(300)
    await expect(page.locator('ol li[data-state]')).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: /写好了/ })).toHaveCount(0)
    await expect(page.getByText('同一个数可以有多种等值的分数表示')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: '哪一课' })).toBeEnabled()
    await expect(page.getByRole('button', { name: /按选定的 1 条要点起草教案/ })).toBeEnabled()
})
