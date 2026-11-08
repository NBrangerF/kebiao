// AI 备课 plumbing: provider failures surfaced and retried with a pause, the log line per step, the 要点 cap and its
// message, name redaction, crawlers kept off /pick, and the 说课稿 told the plan's own 课时.
// Run: cd apps/api && npx tsx test/lesson-plan-be-plumbing.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { FileCurriculumRepository } from '@curriculum/core'
import { createApp } from '../src/app.js'
import { redactSensitiveText } from '../src/ai-privacy.js'
import { retryWaitMs, runRetriedLlm, runStructuredLlm, type StructuredLlmAdapter } from '../src/llm.js'

const publicDataRoot = resolve(process.cwd(), '../../public/data')
const app = createApp(new FileCurriculumRepository(publicDataRoot))
const json = async (response: Response) => JSON.parse(await response.text())

const LIMITED = 'MA-S3-NA-01.3'
const ENV = { KEBIAO_LLM_API_KEY: 'test-secret', KEBIAO_LLM_BASE_URL: 'https://llm.example.test/v1' }
const adapter: StructuredLlmAdapter<{ ok: boolean }> = {
    name: 'test',
    schema: { type: 'object' },
    instructions: 'test',
    chatInstructions: 'test',
    maxCompletionTokens: 100,
    validate: value => (value && typeof value === 'object' && (value as { ok?: unknown }).ok === true ? { ok: true } : null)
}
const answer = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { status: 200, headers: { 'content-type': 'application/json' } })

const frame = (text = '学生能借助折纸和画图，说出分数的分子和分母同时乘或除以相同的数（0 除外），分数大小不变') => ({
    title: '分数的基本性质',
    core_understanding: '分数的大小不变，分子分母可以同时变化',
    objectives: [{ id: 'O1', text, basis: [LIMITED], kind: '理解' }],
    key_points: ['理解分数的基本性质'],
    difficult_points: ['说清为什么 0 除外'],
    learner_analysis: '学生已经学过分数的意义和分数与除法的关系。',
    prior_knowledge: ['分数的意义'],
    misconceptions: [{ text: '分子分母同时加上相同的数，分数大小不变', response: '用画图反例说明' }],
    keywords: [{ term: '分数的基本性质', definition: '分子分母同乘或同除以相同的数（0 除外），大小不变' }],
    assessments: [{ id: 'A1', objective_ids: ['O1'], task: '完成三道化分母的题并说理由', evidence: '学习单', criteria: '三题全对且能说理' }]
})
const planProcess = {
    stages: [
        { name: '导入', minutes: 5, org: '全班', teacher: '出示折纸', students: '观察', purpose: '引入', objective_ids: ['O1'], assessment_ids: [] },
        { name: '探究', minutes: 25, org: '同桌', teacher: '组织折纸', students: '折纸比较', purpose: '发现规律', objective_ids: ['O1'], assessment_ids: ['A1'] },
        { name: '练习', minutes: 10, org: '独立', teacher: '巡视', students: '完成学习单', purpose: '巩固', objective_ids: ['O1'], assessment_ids: ['A1'] }
    ],
    board: ['分数的基本性质'],
    homework: ['完成练习一']
}

// the 34 要点 of the 5 年级 math standards, in data order
const math = JSON.parse(await readFile(resolve(publicDataRoot, 'v2/by_subject/math.json'), 'utf8'))
const grade5Codes: string[] = math.standards.filter((item: any) => item.grades.includes(5)).flatMap((item: any) => (item.indicators || []).map((point: any) => point.code))

function withKey(t: { after: (fn: () => void) => void }) {
    const saved = process.env.KEBIAO_LLM_API_KEY
    process.env.KEBIAO_LLM_API_KEY = 'test-secret'
    t.after(() => { if (saved === undefined) delete process.env.KEBIAO_LLM_API_KEY; else process.env.KEBIAO_LLM_API_KEY = saved })
}

// the request's log line, as the metrics file keeps it
async function loggedAi(t: { after: (fn: () => void) => void }, name: string, send: () => Response | Promise<Response>) {
    const file = resolve(tmpdir(), `kebiao-be-plumbing-${name}-${process.pid}.ndjson`)
    await rm(file, { force: true })
    process.env.CURRICULUM_METRICS_FILE = file
    t.after(async () => { delete process.env.CURRICULUM_METRICS_FILE; await rm(file, { force: true }) })
    const response = await send()
    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    return { response, ai: JSON.parse(lines.at(-1) || '{}').ai }
}

test('a provider error carries its HTTP status and the start of its error text, keys masked', async () => {
    const failed = await runStructuredLlm('x', adapter, {
        env: ENV,
        timeoutMs: 5000,
        fetchImpl: async () => new Response(`{"error":{"message":"当前分组上游负载已饱和 no available channel for model gpt-5-mini, key sk-abcdef123456 ${'x'.repeat(300)}"}}`, { status: 503 })
    })
    assert.equal(failed.status, 'provider_error')
    assert.equal(failed.provider_status, 503)
    assert.match(String(failed.provider_error), /no available channel/)
    assert.doesNotMatch(String(failed.provider_error), /abcdef123456/)
    assert.ok(String(failed.provider_error).length <= 160)

    // no answer at all
    const reset = await runStructuredLlm('x', adapter, { env: ENV, timeoutMs: 5000, fetchImpl: async () => { throw new TypeError('fetch failed: ECONNRESET') } })
    assert.equal(reset.status, 'provider_error')
    assert.equal(reset.provider_status, 'network')
    assert.match(String(reset.provider_error), /ECONNRESET/)
})

test('the second attempt waits 1–3 s after an error answer, or the provider\'s Retry-After up to 5 s', () => {
    // JSON that did not fit: the provider is up, so at once
    assert.equal(retryWaitMs({ status: 'invalid_response' }, 90000), 0)
    // an error answer: 1–3 s, spread
    assert.equal(retryWaitMs({ status: 'provider_error' }, 90000, () => 0), 1000)
    assert.equal(retryWaitMs({ status: 'provider_error' }, 90000, () => 1), 3000)
    // Retry-After is honoured up to 5 s; a longer one (a spent quota) is not retried
    assert.equal(retryWaitMs({ status: 'provider_error', retry_after_ms: 2000 }, 90000), 2000)
    assert.equal(retryWaitMs({ status: 'provider_error', retry_after_ms: 8000 }, 90000), null)
    // never more than half of what is left of the budget
    assert.equal(retryWaitMs({ status: 'provider_error' }, 3000, () => 1), 1500)
    assert.equal(retryWaitMs({ status: 'provider_error', retry_after_ms: 4000 }, 6000), null)
})

test('runRetriedLlm pauses for Retry-After, reports both attempts and the whole wait', async () => {
    let calls = 0
    const sent: number[] = []
    const started = performance.now()
    const run = await runRetriedLlm('x', adapter, {
        env: ENV,
        timeoutMs: 20000,
        fetchImpl: async () => {
            calls += 1
            sent.push(performance.now() - started)
            return calls === 1 ? new Response('rate limited', { status: 429, headers: { 'retry-after': '1' } }) : answer({ ok: true })
        }
    })
    assert.equal(run.status, 'ok')
    assert.equal(run.attempts, 2)
    assert.ok(sent[1] - sent[0] >= 950, `second call after ${sent[1] - sent[0]} ms`)
    assert.ok(run.latency_ms >= 950, `latency ${run.latency_ms} ms covers the pause`)

    // a quota that resets in a minute is not asked again
    let quota = 0
    const spent = await runRetriedLlm('x', adapter, { env: ENV, timeoutMs: 20000, fetchImpl: async () => { quota += 1; return new Response('quota', { status: 429, headers: { 'retry-after': '60' } }) } })
    assert.equal(quota, 1)
    assert.equal(spent.attempts, 1)
    assert.equal(spent.provider_status, 429)
})

test('the draft log line names the step, the attempts and the provider status of a failed call', async t => {
    withKey(t)
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => {
        calls += 1
        if (calls === 1) return new Response('{"error":"no available channel"}', { status: 502, headers: { 'retry-after': '0' } })
        return answer(frame())
    })
    const { response, ai } = await loggedAi(t, 'frame', () => app.request('/api/v1/lesson-plans/draft', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.201' }, body: JSON.stringify({ step: 'frame', lesson: { title: '分数的基本性质', subject_slug: 'math', grade: 5 }, indicator_codes: [LIMITED] }) }))
    assert.equal(response.status, 200)
    assert.equal(ai.feature, 'lesson_plan')
    assert.equal(ai.step, 'frame')
    assert.equal(ai.status, 'ok')
    assert.equal(ai.attempts, 2)
    assert.equal(ai.retries, 1)
    assert.equal(ai.provider_status, 502)
    assert.match(ai.provider_error, /no available channel/)
    assert.equal(typeof ai.first_latency_ms, 'number')
})

test('the draft log line carries the 自查 when it ran', async t => {
    withKey(t)
    let calls = 0
    // the first frame breaks a hard rule (an objective not starting 「学生能」), the fix keeps it
    t.mock.method(globalThis, 'fetch', async () => {
        calls += 1
        return answer(calls === 1 ? frame('借助折纸和画图，说出分数的分子和分母同时乘或除以相同的数，分数大小不变') : frame())
    })
    const { response, ai } = await loggedAi(t, 'selfcheck', () => app.request('/api/v1/lesson-plans/draft', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.202' }, body: JSON.stringify({ step: 'frame', lesson: { title: '分数的基本性质', subject_slug: 'math', grade: 5 }, indicator_codes: [LIMITED] }) }))
    assert.equal(response.status, 200)
    assert.equal(ai.step, 'frame')
    assert.equal(ai.attempts, 2)
    assert.equal(ai.retries, 0)
    assert.equal(ai.provider_status, undefined)
    assert.ok(ai.self_check.sent >= 1)
    assert.equal(ai.self_check.kept, true)
    assert.equal(ai.self_check.status, 'ok')
})

test('the pick log line names the step and how its calls ended', async t => {
    withKey(t)
    t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
        const user = String(JSON.parse(String(init?.body)).messages[1].content)
        const codes = [...user.matchAll(/【([A-Z]{2}-S\d-[A-Z]{2,3}-\d{2})】/gu)].map(match => match[1])
        return answer({ judgements: codes.map(code => ({ code, grade: 0, reason: '不相关', point: '' })) })
    })
    const { response, ai } = await loggedAi(t, 'pick', () => app.request('/api/v1/lesson-plans/pick', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.203' }, body: JSON.stringify({ lesson: { title: '日志测试课（be-plumbing）', subject_slug: 'math', grade: 5 } }) }))
    assert.equal(response.status, 200)
    assert.equal(ai.step, 'pick')
    assert.ok(ai.judge_read > 0)
    assert.match(ai.judge_calls, /^ok:\d+$/)
    assert.equal(ai.attempts, Number(ai.judge_calls.split(':')[1]))
})

test('up to 16 要点 are accepted: a unit reads all 16, a lesson the first 12 and says so; 17 get a message naming the limit', async t => {
    withKey(t)
    const prompts: string[] = []
    t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
        prompts.push(String(JSON.parse(String(init?.body)).messages[1].content))
        // JSON that does not fit: the unit draft fails at once, after its prompt is seen
        return answer({ nothing: true })
    })
    const sixteen = grade5Codes.slice(0, 16)
    const unit = await app.request('/api/v1/lesson-plans/draft', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.204' }, body: JSON.stringify({ step: 'unit', lesson: { title: '多个要点的单元', subject_slug: 'math', grade: 5 }, indicator_codes: sixteen, unit_lessons: ['一', '二'], unit_hours: 2 }) })
    assert.equal(unit.status, 502)
    assert.ok(prompts[0].includes(`${sixteen[15]}：`), 'the 16th 要点 reaches the unit prompt')

    t.mock.method(globalThis, 'fetch', async () => answer(frame()))
    const lesson = await app.request('/api/v1/lesson-plans/draft', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.204' }, body: JSON.stringify({ step: 'frame', lesson: { title: '分数的基本性质', subject_slug: 'math', grade: 5 }, indicator_codes: grade5Codes.slice(0, 14) }) })
    assert.equal(lesson.status, 200)
    const drafted = (await json(lesson)).data
    assert.equal(drafted.evidence.length, 12)
    assert.equal(drafted.checks[0].kind, 'too_many_points')
    assert.match(drafted.checks[0].message, /勾了 14 条要点.*前 12 条/)

    const tooMany = await app.request('/api/v1/lesson-plans/draft', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.204' }, body: JSON.stringify({ step: 'unit', lesson: { title: '多个要点的单元', subject_slug: 'math', grade: 5 }, indicator_codes: grade5Codes.slice(0, 17) }) })
    assert.equal(tooMany.status, 422)
    const refused = await json(tooMany)
    assert.match(refused.error.message, /要点最多选 16 条，现在选了 17 条/)
    assert.doesNotMatch(refused.error.message, /请求参数校验失败/)

    const none = await app.request('/api/v1/lesson-plans/draft', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.204' }, body: JSON.stringify({ step: 'frame', lesson: { title: '分数的基本性质', subject_slug: 'math', grade: 5 }, indicator_codes: [] }) })
    assert.equal(none.status, 422)
    assert.match((await json(none)).error.message, /至少勾选一条/)
})

test('pupil names next to a score are removed; words around a score are left alone', () => {
    const removed: Array<[string, string, number]> = [
        ['张三：58分，李四：61分', '某学生：58分，某学生：61分', 2],
        ['于洋 52 分，傅雷 48 分，温馨请假', '某学生 52 分，某学生 48 分，某学生请假', 3],
        ['欧阳娜娜数学 58 分', '某学生数学 58 分', 1],
        ['司马光请假', '某学生请假', 1],
        ['其中王小明 58 分', '其中某学生 58 分', 1],
        ['张三数学 58 分、李四 61 分，王小明请假刚回来', '某学生数学 58 分、某学生 61 分，某学生请假刚回来', 3]
    ]
    for (const [text, expected, count] of removed) {
        const result = redactSensitiveText(text)
        assert.equal(result.text, expected, text)
        assert.equal(result.redaction_count, count, text)
    }
    for (const text of ['平均分高于 80 分', '前测历史考了 85 分', '成绩高于 85 分的学生', '最高分 98 分', '低于 60 分的有 5 人', '高于80分的有12人', '马上要期中考试']) {
        const result = redactSensitiveText(text)
        assert.equal(result.text, text)
        assert.equal(result.redaction_count, 0, text)
    }
})

test('/pick refuses crawler user agents before any model call; a browser still gets its pick', async t => {
    withKey(t)
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => { calls += 1; return answer({ judgements: [] }) })
    const body = JSON.stringify({ lesson: { title: '分数的基本性质（爬虫测试）', subject_slug: 'math', grade: 5 } })
    for (const agent of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36', 'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)']) {
        const response = await app.request('/api/v1/lesson-plans/pick', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': agent, 'x-forwarded-for': '203.0.113.205' }, body })
        assert.equal(response.status, 403, agent)
        assert.equal((await json(response)).error.code, 'crawler_not_allowed')
    }
    assert.equal(calls, 0)
    const browser = await app.request('/api/v1/lesson-plans/pick', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50', 'x-forwarded-for': '203.0.113.205' }, body })
    assert.equal(browser.status, 200)
    assert.ok(calls > 0)
})
