import { expect, test } from '@playwright/test'
import { docPlan, openSavedPlan, talkDraft } from './helpers/lessonPlanDocFixture.js'

const envelope = data => ({ data, meta: { request_id: 'e2e', data_version: 'e2e', schema_version: '1.0.0', warnings: [] } })
const doc = page => page.getByRole('article', { name: docPlan.frame.title })

test('the plan toolbar: one primary 下载 Word, then 简案 and 复制全文, the rest under a keyboard-friendly 更多', async ({ page }) => {
    await openSavedPlan(page)
    const plan = doc(page)
    const primary = plan.locator('.btn-primary')
    await expect(primary).toHaveCount(1)
    await expect(primary).toHaveText('下载 Word（详案）')
    await expect(plan.getByRole('button', { name: '简案（上课用）' })).toBeVisible()
    await expect(plan.getByRole('button', { name: '复制全文' })).toBeVisible()
    const folded = ['打印', '生成说课稿', '试讲稿 + 答辩', '听课观察表', '课后反思表']
    for (const name of folded) await expect(plan.getByRole('button', { name })).toBeHidden()

    // Tab to 更多 and open it with Enter; Escape closes it and leaves focus on 更多
    const more = plan.locator('summary', { hasText: '更多' })
    await more.focus()
    await page.keyboard.press('Enter')
    for (const name of folded) await expect(plan.getByRole('button', { name })).toBeVisible()
    await plan.getByRole('button', { name: '打印' }).focus()
    await page.keyboard.press('Escape')
    await expect(plan.getByRole('button', { name: '打印' })).toBeHidden()
    await expect(more).toBeFocused()
    // a tap outside closes it too
    await more.click()
    await expect(plan.getByRole('button', { name: '听课观察表' })).toBeVisible()
    await page.getByRole('heading', { name: '二、教学目标' }).click()
    await expect(plan.getByRole('button', { name: '听课观察表' })).toBeHidden()
})

test('本页 links reach every part the plan has', async ({ page }) => {
    await openSavedPlan(page)
    const jump = page.getByRole('navigation', { name: '本页' })
    const links = jump.getByRole('link')
    await expect(links).toHaveText(['课标分析', '目标', '重难点', '学情', '评价', '过程', '练习', '板书', '作业'])
    for (const href of await links.evaluateAll(items => items.map(item => item.getAttribute('href')))) {
        expect(await page.locator(href).count(), href).toBe(1)
    }
    await jump.getByRole('link', { name: '作业' }).click()
    await expect(page.getByRole('heading', { name: '十、作业设计' })).toBeInViewport()
    await expect(page).toHaveURL(/#lp-sec-homework$/u)
})

test('the AI\'s ids read as 目标 n and 评价 n; the 评价任务 rows are numbered to match', async ({ page }) => {
    await openSavedPlan(page, { ...docPlan, lesson: { ...docPlan.lesson, subject_slug: 'chinese' } })
    const plan = doc(page)
    const stage = plan.getByRole('listitem').filter({ hasText: '折纸探究' })
    await expect(stage.getByText('目标 1', { exact: true })).toBeVisible()
    await expect(stage.getByText('评价 1', { exact: true })).toBeVisible()
    await expect(plan.getByText('完成目标 1与评价任务（评价 1）')).toBeVisible()
    await expect(plan.getByText('完成目标 2并为评价 2准备作业')).toBeVisible()
    await expect(plan.getByText('课堂作业：完成分数改写表（评价 2）')).toBeVisible()
    // A4纸 is paper, not an assessment
    await expect(plan.getByText(/在家完成分数改写表（评价 2），用A4纸画图/u)).toBeVisible()
    const rows = plan.getByRole('region', { name: '评价任务表' }).locator('tbody tr')
    await expect(rows.nth(0).locator('td').first()).toHaveText('评价 1用折纸说明 1/2=2/4')
    await expect(rows.nth(1).locator('td').last()).toHaveText('目标 2')
    const text = await plan.innerText()
    expect(text).not.toMatch(/(^|[^A-Za-z0-9])[OA][1-3](?![A-Za-z0-9])(?!纸)/u)
})

test('in 数学 a bare id stays as the AI wrote it; only a bracket of ids reads as 目标 n or 评价 n', async ({ page }) => {
    await openSavedPlan(page)
    const plan = doc(page)
    const stage = plan.getByRole('listitem').filter({ hasText: '折纸探究' })
    await expect(stage.getByText('目标 1', { exact: true })).toBeVisible()
    await expect(stage.getByText('评价 1', { exact: true })).toBeVisible()
    await expect(plan.getByText('完成O1与评价任务（评价 1）')).toBeVisible()
    await expect(plan.getByText('完成O2并为A2准备作业')).toBeVisible()
    await expect(plan.getByText('课堂作业：完成分数改写表（评价 2）')).toBeVisible()
    const rows = plan.getByRole('region', { name: '评价任务表' }).locator('tbody tr')
    await expect(rows.nth(0).locator('td').first()).toHaveText('评价 1用折纸说明 1/2=2/4')
})

// points A1/A2, circle centres O1/O2 and ammeters A1/A2 are lesson content, not the plan's ids
const withContent = (subject_slug, question, answer) => ({
    ...docPlan,
    lesson: { ...docPlan.lesson, subject_slug },
    practice: { items: [{ ...docPlan.practice.items[0], question, answer }] }
})

test('a 数学 plan keeps its points and circles: 点A1, ⊙O1, A1、A2、A3', async ({ page }) => {
    await openSavedPlan(page, withContent('math', '点A平移后得到点A1，⊙O1与⊙O2外切。', 'A1、A2、A3三点在同一直线上'))
    const plan = doc(page)
    await expect(plan.getByText('点A平移后得到点A1，⊙O1与⊙O2外切。')).toBeVisible()
    await plan.locator('summary', { hasText: '参考答案' }).click()
    await expect(plan.getByText('A1、A2、A3三点在同一直线上')).toBeVisible()
})

test('a 物理 plan keeps its ammeters: 电流表A1', async ({ page }) => {
    await openSavedPlan(page, withContent('physics', '闭合开关后，电流表A1的示数比A2大，说明什么？', '电流表A1测干路电流'))
    const plan = doc(page)
    await expect(plan.getByText('闭合开关后，电流表A1的示数比A2大，说明什么？')).toBeVisible()
    await plan.locator('summary', { hasText: '参考答案' }).click()
    await expect(plan.getByText('电流表A1测干路电流')).toBeVisible()
    // its own ids in brackets still read as 评价 n
    await expect(plan.getByText('课堂作业：完成分数改写表（评价 2）')).toBeVisible()
})

test('核验 says how many checks passed and lists the 提醒 first, in words', async ({ page }) => {
    await openSavedPlan(page)
    const checks = page.getByRole('region', { name: '核验' })
    await expect(checks.getByText('通过 1 项 · 提醒 1 项')).toBeVisible()
    await expect(checks.getByRole('listitem')).toHaveText([/^提醒当堂练习的用时/u, /^通过每条目标都有/u])
})

test('a 说课稿 comes into view with focus on its title; the button says it is working', async ({ page }) => {
    let release
    const gate = new Promise(resolve => { release = resolve })
    await page.route('**/api/v1/lesson-plans/draft', async route => {
        await gate
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(envelope(talkDraft)) })
    })
    await openSavedPlan(page)
    const plan = doc(page)
    await plan.locator('summary', { hasText: '更多' }).click()
    await plan.getByRole('button', { name: '生成说课稿' }).click()
    await expect(plan.getByRole('button', { name: '正在写说课稿…' })).toBeDisabled()
    await expect(plan.locator('summary', { hasText: '正在写' })).toBeVisible()
    release()
    const title = page.getByRole('heading', { name: `《${docPlan.frame.title}》说课稿` })
    await expect(title).toBeFocused()
    await expect(title).toBeInViewport()
})

test('打印 prints the plan alone, answers and 课标原文 open, 核验 last', async ({ page }) => {
    await page.route('**/api/v1/lesson-plans/draft', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(envelope(talkDraft)) }))
    await openSavedPlan(page)
    const plan = doc(page)
    await plan.locator('summary', { hasText: '更多' }).click()
    await plan.getByRole('button', { name: '生成说课稿' }).click()
    const talk = page.getByRole('article', { name: /说课稿/u })
    await expect(talk).toBeVisible()
    // the print dialog itself is not opened in a test: window.print only fires beforeprint
    await page.evaluate(() => { window.print = () => window.dispatchEvent(new Event('beforeprint')) })
    // 更多 stays open while its AI action runs, so the button can say so
    await expect(plan.getByRole('button', { name: '打印' })).toBeVisible()
    await plan.getByRole('button', { name: '打印' }).click()
    expect(await plan.locator('section details').evaluateAll(items => items.map(item => item.open))).toEqual([true, true, true])
    await page.emulateMedia({ media: 'print' })
    await expect(talk).toBeHidden()
    await expect(plan.getByText('8/12', { exact: true })).toBeVisible()
    await expect(plan.getByText('能比较两个分数的大小。')).toBeVisible()
    const order = await plan.evaluate(article => {
        const top = selector => article.querySelector(selector).getBoundingClientRect().top
        return { checks: top('[aria-label="核验"]'), homework: top('#lp-sec-homework') }
    })
    expect(order.checks).toBeGreaterThan(order.homework)
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
    await page.emulateMedia({ media: 'screen' })
    expect(await plan.locator('section details').evaluateAll(items => items.map(item => item.open))).toEqual([false, false, false])
    await expect(talk).toBeVisible()
})

test('on a phone the plan fits: one toolbar row, 评价任务 as cards, 44 px targets, no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openSavedPlan(page)
    const plan = doc(page)
    expect(await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth)).toBe(true)
    const tops = await plan.locator('[class*="docActions"] > *').evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().top)))
    expect(tops).toHaveLength(4)
    expect(new Set(tops).size).toBe(1)
    // every column of the 评价任务 table is on screen, labelled
    const card = plan.getByRole('region', { name: '评价任务表' }).locator('tbody tr').first()
    for (const label of ['证据', '达成标准', '对应目标']) {
        const cell = card.locator(`td[data-label="${label}"]`)
        const box = await cell.boundingBox()
        expect(box.x + box.width).toBeLessThanOrEqual(375)
        expect(await cell.evaluate(item => getComputedStyle(item, '::before').content)).toBe(`"${label}"`)
    }
    const small = await page.locator('nav[aria-label="本页"] a, article summary, article [class*="docActions"] .btn').evaluateAll(items => items.filter(item => item.getBoundingClientRect().height && item.getBoundingClientRect().height < 44).map(item => item.textContent))
    expect(small).toEqual([])
    await plan.locator('summary', { hasText: '更多' }).click()
    expect(await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth)).toBe(true)
})

test('a disabled button looks disabled, and the 目标体检 box will not zoom an iPhone', async ({ page }) => {
    const context = {
        lesson: { title: '分数的基本性质', unit_title: '', textbook_title: '', edition_id: '', edition_name: '', unit_id: null, lesson_id: null, subject_slug: 'math', grade: 5, pdf_page: null, printed_page: '' },
        standards: [{ code: 'MA-S3-NA-01', title: '数与运算（5–6 年级）', subject: '数学', subject_slug: 'math', stage_label: '第三学段（5–6 年级）', level1: '数与代数', level2: '数与运算', statement: '', statement_source: '', via: 'search', suggested: [], requirements: [], guidance: [], examples: [], indicators: [{ code: 'MA-S3-NA-01.3', text: '能比较两个分数的大小。', pages: [31] }] }],
        subject_note: { name: '数学' }, national_lessons: [], national_confidence: 'text'
    }
    await page.route('**/api/v1/lesson-plans/context?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(envelope(context)) }))
    await page.route('**/api/v1/lesson-plans/pick', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(envelope({ status: 'timeout', read: 9, picks: [] })) }))
    await page.goto('/lesson-plan?mode=topic&subject=%E6%95%B0%E5%AD%A6&grade=5&topic=%E5%88%86%E6%95%B0%E7%9A%84%E5%9F%BA%E6%9C%AC%E6%80%A7%E8%B4%A8')
    const go = page.getByRole('button', { name: /按选定的 0 条要点起草教案/ })
    await expect(go).toBeDisabled()
    expect(Number(await go.evaluate(item => getComputedStyle(item).opacity))).toBeLessThan(0.6)
    expect(await go.evaluate(item => getComputedStyle(item).cursor)).toBe('not-allowed')
    const fonts = await page.locator('main textarea, main input[type="text"], main select').evaluateAll(items => items.map(item => parseFloat(getComputedStyle(item).fontSize)))
    expect(fonts.length).toBeGreaterThan(0)
    expect(Math.min(...fonts)).toBeGreaterThanOrEqual(16)
})
