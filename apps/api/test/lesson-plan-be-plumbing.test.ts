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
