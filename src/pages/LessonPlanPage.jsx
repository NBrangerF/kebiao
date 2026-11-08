import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning'
import { XCircleIcon } from '@phosphor-icons/react/dist/csr/XCircle'
import { postApi } from '../data/api'
import { trackUmamiEvent } from '../observability/umamiTelemetry.js'
import { loadTextbookCatalog } from '../features/textbooks/textbookApi'
import { bookFields, readMyBook, saveMyBook } from '../features/mybook/myBook.js'
import { downloadBriefWord, downloadObservationWord, downloadReflectionWord, downloadRubricWord, downloadSkeletonWord, downloadScriptWord, downloadWord, downloadUnitWord, planToText, unitToText } from '../features/lesson-plan/lessonPlanExport'
import { usePageMeta } from '../seo/usePageMeta.js'
import { STATIC_PAGE_META } from '../seo/pageMeta.js'
import styles from './LessonPlanPage.module.css'
import { sourceLabel } from '../features/textbooks/alignmentModel'
import LessonGoals from '../features/textbooks/LessonGoals'
import ObjectiveCheck from '../features/lesson-plan/ObjectiveCheck'
import { COPY_FALLBACK_EVENT, copyText } from '../features/lesson-plan/copyText.js'
import { errorText } from '../features/lesson-plan/errorText.js'
import { loadBank, presentHref, questionsForLesson } from '../features/checks/checksData.js'
import { subjectBySlug } from '../features/checks/subjects.js'
import { subjectOfCode } from '../data/v2Data.js'

// the last 10 drafts stay in this browser; the old single-draft key is read once and folded in
const STORE_KEY = 'kebiao.lessonPlan.history'
const OLD_KEY = 'kebiao.lessonPlan.last'
const HISTORY_SIZE = 10
const SUBJECT_ORDER = ['语文', '数学', '英语', '道德与法治', '科学', '物理', '化学', '生物学', '历史', '地理', '信息科技', '体育与健康', '音乐', '美术', '劳动']
// 「直接写课题」 covers every 课标, including subjects with no textbook in the library
const TOPIC_SUBJECTS = [['语文', 'chinese'], ['数学', 'math'], ['英语', 'english'], ['道德与法治', 'morality_law'], ['科学', 'science'], ['物理', 'physics'], ['化学', 'chemistry'], ['生物学', 'biology'], ['历史', 'history'], ['地理', 'geography'], ['信息科技', 'it'], ['体育与健康', 'pe'], ['艺术（音乐、美术等）', 'arts'], ['劳动', 'labor']]
const MATERIAL_ORDER = ['视频课程', '课件', '教学设计', '学习任务单', '课后练习']
const STEPS = [
    { key: 'frame', label: 'AI 读课标，写目标、重难点和评价', hint: '同时写课标解读，一般 20–40 秒，慢时 1–2 分钟' },
    { key: 'process', label: 'AI 写教学过程、当堂练习和板书', hint: '一般 20–40 秒，慢时 1–2 分钟' },
    { key: 'check', label: '对照课标和课堂实际核验', hint: '编码、超标、目标—活动—评价、时间与作业量' }
]
// the class as it usually is: about 45 students; 课型 left to the AI unless the teacher says
const CLASS_SIZES = [30, 35, 40, 45, 50, 55, 60]
const LESSON_TYPES = ['新授课', '复习课', '练习课', '实验课', '讲评课']

// When the AI is slow or down, a teacher drafting a plan still has a way on: the ticked 要点 as a prompt for
// another AI, or a skeleton to write in. `kept` is true when a half plan is saved for 「继续写」.
function aiError(errorValue, { drafting = false, kept = false } = {}) {
    // fetch itself failed (no HTTP status): a phone that locked or switched apps, or a dropped connection
    const dropped = '网络连接中断了（手机锁屏、切到别的应用或信号不好时常见）。'
    if (!errorValue.status && drafting) return kept ? `${dropped}已写好的部分存在这台设备上，可以点「继续写」接着写，或重新起草。` : `${dropped}请保持屏幕亮着，再试一次。`
    if (drafting && errorValue.status >= 500) return `${errorValue.message} 也可以先点上面的「复制成提示词」，把勾好的要点带到豆包、DeepSeek 里写；或「下载教案框架」自己写。`
    return errorText(errorValue)
}

// the server takes at most this many 要点 for one draft; the page says so before a request is refused
const MAX_POINTS = { lesson: 12, unit: 16 }

// automated browsers and crawlers render the page without reading it; there the AI pick waits for a click.
// Local runs (the e2e tests) keep the automatic pick.
function automatedVisit() {
    if (typeof navigator === 'undefined') return false
    if (/(?:bot|crawler|spider)\/|bytespider|bingpreview|slurp/iu.test(navigator.userAgent || '')) return true
    return Boolean(navigator.webdriver) && !/^(localhost|127\.0\.0\.1|\[::1\])$/u.test(window.location.hostname)
}

// WeChat's browser cannot save a downloaded file (as ShareStandardButton notes)
const inWeChat = () => typeof navigator !== 'undefined' && /MicroMessenger/iu.test(navigator.userAgent || '')

// a 目录 title without its 「第一节」/「1」 prefix: a reprint renames 「疆域」 to 「第一节 疆域」
const bareTitle = title => String(title || '').replace(/^(第[一二三四五六七八九十百\d]+[节课章单元]+|\d+)\s*/u, '').replace(/\s+/gu, '')

// where the picker's lessons come from: the 国家平台 list, and the book's own 目录 for what the list lacks
function lessonSource({ platform_title: platform, confidence, lessons }) {
    const fromToc = lessons.some(item => item.toc)
    const edition = confidence === 'edition' ? '平台这一册的版本可能和你手上的不同，请留意课题是否一致。' : ''
    if (!lessons.some(item => !item.toc)) return '课按这本书自己的目录列出，国家平台没有这一册的同步课。'
    return `课时目录来自国家中小学智慧教育平台「${platform}」${fromToc ? '，平台缺的课按这本书自己的目录补上' : ''}。${edition}`
}

async function getJson(url, signal) {
    const response = await fetch(url, { signal })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
        const error = new Error(payload?.error?.message || `请求失败（${response.status}）`)
        error.status = response.status
        throw error
    }
    return payload.data
}

// the lesson as the draft API takes it
function draftLesson(lesson) {
    return {
        title: lesson.title,
        ...(lesson.unit_title ? { unit_title: lesson.unit_title.slice(0, 60) } : {}),
        ...(lesson.textbook_title ? { textbook_title: lesson.textbook_title } : {}),
        ...(lesson.edition_name ? { edition_name: lesson.edition_name } : {}),
        subject_slug: lesson.subject_slug,
        grade: lesson.grade || null,
        ...(lesson.pdf_page ? { pages: `PDF 第 ${lesson.pdf_page} 页起` } : {}),
        // the book and its 国家平台 lesson: the 课标解读 says where else the book teaches these 要点
        ...(/^ed_[0-9a-f]+$/u.test(lesson.edition_id || '') ? { edition_id: lesson.edition_id } : {}),
        ...(lesson.lesson_id ? { lesson_id: String(lesson.lesson_id).slice(0, 60) } : {})
    }
}

// a saved draft that cannot be shown (an older shape, or edited by hand) is skipped instead of blanking the page
const usable = item => Boolean(item?.lesson?.title && Array.isArray(item.evidence) && (!item.frame || Array.isArray(item.frame.objectives)))
function readStored() {
    try {
        const history = JSON.parse(window.localStorage.getItem(STORE_KEY) || '[]')
        const old = JSON.parse(window.localStorage.getItem(OLD_KEY) || 'null')
        return (Array.isArray(history) ? (old && !history.length ? [old] : history) : []).filter(usable)
    } catch { return [] }
}
const storedKey = item => `${item.lesson?.title}|${item.created_at}`
function saveHistory(history) {
    try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(history))
        window.localStorage.removeItem(OLD_KEY)
    } catch { /* private mode or full */ }
    return history
}
function writeStored(plan) {
    return saveHistory([plan, ...readStored().filter(item => storedKey(item) !== storedKey(plan))].slice(0, HISTORY_SIZE))
}
const removeStored = plan => saveHistory(readStored().filter(item => storedKey(item) !== storedKey(plan)))
// the request a saved plan was drafted with, to write its missing parts again (older saves lack the notes)
function requestOf(plan) {
    const meta = plan.meta || {}
    return {
        lesson: draftLesson(plan.lesson),
        indicator_codes: plan.evidence.map(item => item.code),
        period_minutes: meta.period_minutes || 40,
        lesson_index: meta.lesson_index || 1,
        lesson_count: meta.lesson_count || 1,
        ...(meta.class_size ? { class_size: meta.class_size } : {}),
        lesson_type: meta.lesson_type || '',
        class_notes: meta.class_notes || '',
        teacher_notes: meta.teacher_notes || ''
    }
}

// a phone that locks during the minute of drafting drops the request; keep the screen on while it runs
async function keepAwake() {
    try {
        const lock = await navigator.wakeLock?.request('screen')
        return () => { lock?.release().catch(() => {}) }
    } catch {
        return () => {}
    }
}

const draftDate = value => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

// common 学情 a teacher can add with one tap; the AI reads them like typed notes
const CLASS_NOTES = ['基础较好，能主动提问', '两极分化明显', '前置知识掌握不牢', '表达说理较弱', '小组合作习惯较好', '注意力容易分散']

const viaLabel = { aligned: '教材页码对齐（机器）', ai_lesson: 'AI 逐课判断', ai_unit: 'AI 按单元判断', search: '按课题检索', ai: 'AI 推荐', seed: '你从标准页选的' }

export default function LessonPlanPage() {
    usePageMeta(STATIC_PAGE_META['/lesson-plan'])
    const [params, setParams] = useSearchParams()
    const [books, setBooks] = useState([])
    const [lessons, setLessons] = useState(null)
    const [base, setBase] = useState(null)
    const [context, setContext] = useState(null)
    const [contextError, setContextError] = useState('')
    const [ai, setAi] = useState({ status: 'idle', reasons: {} })
    const [selected, setSelected] = useState(() => new Set())
    const [settings, setSettings] = useState({ period: 40, periodSet: false, index: 1, count: 1, classSize: 45, lessonType: '', classNotes: '', teacherNotes: '' })
    const [unitPlan, setUnitPlan] = useState(null)
    // what is being written after the plan: '' | 'talk' (说课稿) | 'trial' (试讲稿) | 'practice' (当堂练习 again)
    const [talking, setTalking] = useState('')
    // a failed 说课稿/试讲稿/练习 shows by the plan, which may be a restored draft with no step 3 on the page
    const [talkError, setTalkError] = useState('')
    const [unitHours, setUnitHours] = useState(0)
    const [hint, setHint] = useState('')
    const [hintFor, setHintFor] = useState('')
    // set by 「让 AI 找要点」 where the pick does not start by itself
    const [pickAsked, setPickAsked] = useState(false)
    const [plan, setPlan] = useState(null)
    const [step, setStep] = useState('')
    const [error, setError] = useState('')
    const [copied, setCopied] = useState(false)
    const [stored, setStored] = useState(readStored)
    const [lessonGone, setLessonGone] = useState(false)
    // a heading to bring into view and focus once it renders: the finished plan, a restored draft, a 说课稿
    const [reveal, setReveal] = useState(null)
    useEffect(() => {
        const heading = reveal && document.getElementById(reveal.id)
        if (!heading) return
        heading.setAttribute('tabindex', '-1')
        heading.focus({ preventScroll: true })
        heading.scrollIntoView({ block: 'start' })
    }, [reveal])
    const revealHeading = id => setReveal({ id, at: Date.now() })
    // 要点 the teacher ticked or unticked while the AI pick ran: its answer does not undo them
    const editsRef = useRef(new Map())
    // 初中 periods are usually 45 minutes and 小学 40, until the teacher picks one
    const lessonGrade = context?.lesson?.grade || 0
    useEffect(() => {
        if (lessonGrade) setSettings(current => (current.periodSet ? current : { ...current, period: lessonGrade >= 7 ? 45 : 40 }))
    }, [lessonGrade])
    // the lesson's own number of 课时 in the book (人教 6上 「分数除法」 has 3), until the teacher picks one
    const bookHours = Math.min(4, context?.national_lessons?.find(item => item.id === context?.lesson?.lesson_id)?.hours || 1)
    useEffect(() => {
        setSettings(current => (current.countSet ? current : { ...current, count: bookHours, index: Math.min(current.index, bookHours) }))
    }, [bookHours])
    const runRef = useRef(0)
    // a unit design still drafting when the lesson changes (browser back/forward) is dropped when it returns
    const unitRunRef = useRef(0)

    const subject = params.get('subject') || ''
    const edition = params.get('edition') || ''
    const lessonId = params.get('lesson') || ''
    const chapter = params.get('chapter') || ''
    const unitId = params.get('unit') || ''
    const topic = params.get('topic') || ''
    const grade = Number(params.get('grade')) || null
    const freeMode = params.get('mode') === 'topic'

    const update = changes => {
        const next = new URLSearchParams(params)
        for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === '' || value === undefined) next.delete(key)
            else next.set(key, String(value))
        }
        setParams(next, { replace: true })
    }

    useEffect(() => { loadTextbookCatalog().then(data => setBooks(data.items || [])).catch(() => setBooks([])) }, [])

    // a teacher uses one textbook all term: an empty visit opens on 「我的书」, the textbook last opened or picked
    useEffect(() => {
        if ([...params.keys()].length) return
        const last = readMyBook()
        if (last?.subject && last?.edition?.startsWith('ed_')) setParams({ subject: last.subject, edition: last.edition }, { replace: true })
    }, []) // eslint-disable-line react-hooks/exhaustive-deps -- once, on arrival

    const subjects = useMemo(() => {
        const names = [...new Set(books.map(book => book.subject))]
        return names.sort((a, b) => SUBJECT_ORDER.indexOf(a) - SUBJECT_ORDER.indexOf(b))
    }, [books])
    const subjectBooks = useMemo(() => books
        .filter(book => book.subject === subject && book.resource_type === 'student_textbook')
        .sort((a, b) => a.grade - b.grade || a.volume.localeCompare(b.volume, 'zh-CN')), [books, subject])
    const book = books.find(item => item.edition_id === edition) || null

    // 国家平台 lesson list for the chosen textbook
    useEffect(() => {
        setLessons(null)
        if (!edition) return
        let active = true
        getJson(`/api/v1/lesson-plans/textbooks/${edition}/lessons`).then(data => active && setLessons(data)).catch(() => active && setLessons({ lessons: [], failed: true }))
        return () => { active = false }
    }, [edition])

    // a lesson id the book no longer has (a reprint replaced its lessons, and 我的书 still points at the old one):
    // the lesson with the same title, else none, with a line saying why
    useEffect(() => {
        if (!lessonId || !lessons?.lessons?.length || lessons.lessons.some(item => item.id === lessonId)) return
        const saved = readMyBook()
        const mine = saved?.edition === edition && saved?.lesson?.id === lessonId
        const match = mine ? lessons.lessons.find(item => bareTitle(item.title) === bareTitle(saved.lesson.title)) : null
        if (!match) {
            setLessonGone(true)
            if (mine) saveMyBook({ subject, edition, lesson: null })
        }
        update({ lesson: match?.id || null })
    }, [lessonId, lessons]) // eslint-disable-line react-hooks/exhaustive-deps -- when the list or the id changes

    // the textbook picked here, and the lesson being prepared, become 「我的书」
    useEffect(() => {
        if (!subject || !edition || freeMode) return
        const lesson = lessonId ? lessons?.lessons?.find(item => item.id === lessonId) : null
        saveMyBook({ subject, edition, ...bookFields(book), ...(lesson ? { lesson: { id: lesson.id, title: lesson.title } } : {}) })
    }, [subject, edition, lessonId, freeMode, book, lessons])

    const lessonGroups = useMemo(() => {
        const groups = []
        for (const lesson of lessons?.lessons || []) {
            const name = lesson.chapters[0] || '其他'
            let group = groups.find(item => item.name === name)
            if (!group) groups.push(group = { name, items: [] })
            // the platform has several teachers' versions of a lesson; the picker lists each title once
            if (!group.items.some(item => item.title === lesson.title)) group.items.push(lesson)
        }
        return groups
    }, [lessons])

    // the lesson's 课标 context, then the AI search that ticks the closest 要点
    const contextQuery = chapter && edition ? `edition_id=${edition}&chapter=${encodeURIComponent(chapter)}`
        : lessonId && edition ? `edition_id=${edition}&lesson_id=${lessonId}`
        : unitId ? `unit_id=${unitId}`
            : freeMode && topic.trim().length >= 2 && subject && grade ? `subject=${encodeURIComponent(TOPIC_SUBJECTS.find(([name]) => name === subject)?.[1] || subjectSlugOf(books, subject))}&grade=${grade}&topic=${encodeURIComponent(topic.trim())}`
                : ''
    const seedCodes = params.get('codes') || ''
    // a hint belongs to one lesson
    if (hintFor !== contextQuery) {
        setHintFor(contextQuery)
        if (hint) setHint('')
    }
    // 1. the lesson's 课标 context; a draft of the lesson before is put away (it stays in 最近的草稿)
    useEffect(() => {
        setBase(null)
        setContext(null)
        setContextError('')
        setAi({ status: 'idle', reasons: {} })
        setSelected(new Set())
        setPickAsked(false)
        setPlan(null)
        setUnitPlan(null)
        unitRunRef.current += 1
        setStep('')
        setError('')
        setTalkError('')
        setUnitHours(0)
        setSettings(current => ({ ...current, index: 1, count: 1, countSet: false }))
        if (!contextQuery) return
        setLessonGone(false)
        let active = true
        // a standard page sends its own code along so it is among the candidates
        getJson(`/api/v1/lesson-plans/context?${contextQuery}${seedCodes ? `&seed=${encodeURIComponent(seedCodes)}` : ''}`)
            .then(data => { if (active) { setBase(data); setContext(data) } })
            .catch(errorValue => active && setContextError(errorText(errorValue)))
        return () => { active = false }
    }, [contextQuery, seedCodes])

    // 2. the AI reads every standard of the subject at this grade and ticks the 要点 this lesson teaches;
    //    a teacher's hint reruns only this step
    useEffect(() => {
        if (!base) return
        const run = ++runRef.current
        editsRef.current = new Map()
        const lesson = base.lesson
        const isUnitPick = Boolean(base.unit_lessons?.length)
        // what the AI ticked, with what the teacher changed meanwhile on top
        const withEdits = codes => {
            const next = new Set(codes)
            for (const [code, on] of editsRef.current) {
                if (on) next.add(code)
                else next.delete(code)
            }
            return next
        }
        // when the live pick fails, the 要点 the AI judged for the whole unit earlier are ticked instead of nothing
        const unitFallback = () => {
            const points = (base.ai_points || []).filter(code => base.standards.some(standard => standard.indicators.some(item => item.code === code)))
            if (!points.length) return false
            setSelected(withEdits(points))
            setAi({ status: 'fallback', reasons: {} })
            return true
        }
        // the lesson was judged on its own pages beforehand (教材与课标对应): tick its 主要在教 要点 with the words
        // that show them, and ask the AI again only when the teacher adds a hint
        const taught = !hint && !isUnitPick ? (base.lesson_align || []).filter(row => row[1] === 'T') : []
        if (taught.length) {
            const reasons = {}
            for (const [point, , quote, source, page] of taught) {
                const code = point.replace(/\.\d+$/u, '')
                if (!reasons[code]) reasons[code] = `主要在教，这一课写着“${quote}”（${sourceLabel(source, page)}）`
            }
            setSelected(new Set(taught.map(row => row[0])))
            setAi({ status: 'lesson', reasons })
            return
        }
        if (!hint && !pickAsked && automatedVisit()) {
            setAi({ status: 'manual', reasons: {} })
            return
        }
        setAi({ status: 'loading', reasons: {} })
        // another lesson, a new hint or leaving the page cancels the pick still running
        const controller = new AbortController()
        postApi('/api/v1/lesson-plans/pick', {
            lesson: {
                title: String(lesson.title || '').slice(0, 60),
                ...(lesson.unit_title ? { unit_title: lesson.unit_title.slice(0, 60) } : {}),
                ...(lesson.textbook_title ? { textbook_title: lesson.textbook_title } : {}),
                subject_slug: lesson.subject_slug,
                grade: lesson.grade || null
            },
            hint,
            lessons: (base.unit_lessons || []).map(item => item.title.slice(0, 60)).slice(0, 20)
        }, controller.signal).then(async payload => {
            if (run !== runRef.current) return
            if (!['ok', 'partial'].includes(payload.data?.status) && unitFallback()) return
            const judged = payload.data?.picks || []
            const picks = judged.filter(item => item.point && item.grade > 0)
            const strict = picks.filter(item => item.grade === 2)
            // nothing direct: the closest related ones, marked as such for the teacher to judge
            const closest = strict.length ? [] : picks.filter(item => item.grade === 1).slice(0, 2)
            const chosen = (strict.length ? strict : closest).slice(0, isUnitPick ? 6 : 3)
            const reasons = Object.fromEntries(judged.filter(item => item.reason).map(item => [item.code, `${item.grade === 2 ? '直接对应' : item.grade === 1 ? '相关' : '不切题'}：${item.reason}`]))
            const missing = [...new Set(chosen.map(item => item.code))].filter(code => !base.standards.some(standard => standard.code === code))
            let standards = base.standards
            if (missing.length) {
                const more = await getJson(`/api/v1/lesson-plans/context?${contextQuery}&codes=${missing.join(',')}${seedCodes ? `&seed=${encodeURIComponent(seedCodes)}` : ''}`, controller.signal)
                if (run !== runRef.current) return
                setContext(more)
                standards = more.standards
            }
            const picked = new Set(chosen.map(item => item.point))
            // a unit spans several 要点: within the standards the AI confirmed, also tick those that share words with the unit's lesson titles
            if (isUnitPick) {
                const titles = base.unit_lessons.map(item => item.title)
                for (const code of new Set(strict.map(item => item.code))) {
                    for (const indicator of standards.find(item => item.code === code)?.indicators || []) {
                        if (picked.size >= 8) break
                        if (titles.some(title => sharedPairs(title, indicator.text) >= 2)) picked.add(indicator.code)
                    }
                }
            }
            setSelected(withEdits(picked))
            const read = ['ok', 'partial'].includes(payload.data?.status)
            setAi({ status: !read ? 'failed' : strict.length ? 'ok' : closest.length ? 'closest' : 'none', reasons })
        }).catch(() => { if (!controller.signal.aborted && run === runRef.current && !unitFallback()) setAi({ status: 'failed', reasons: {} }) })
        return () => controller.abort()
    }, [base, hint, pickAsked]) // contextQuery changes always replace base first

    const toggle = code => {
        const on = !selected.has(code)
        editsRef.current.set(code, on)
        setSelected(current => {
            const next = new Set(current)
            if (on) next.add(code)
            else next.delete(code)
            return next
        })
    }

    async function generate() {
        if (!context || !selected.size || selected.size > MAX_POINTS.lesson) return
        setError('')
        setTalkError('')
        setCopied(false)
        const lesson = context.lesson
        const subjectName = context.subject_note?.name || subject
        const request = {
            lesson: draftLesson(lesson),
            indicator_codes: [...selected],
            period_minutes: settings.period,
            lesson_index: Math.min(settings.index, settings.count),
            lesson_count: settings.count,
            class_size: settings.classSize,
            lesson_type: settings.lessonType,
            class_notes: settings.classNotes,
            teacher_notes: settings.teacherNotes
        }
        const base = { lesson: { ...lesson, subject_name: subjectName }, meta: { period_minutes: settings.period, lesson_index: request.lesson_index, lesson_count: settings.count } }
        setPlan(null)
        const release = await keepAwake()
        let kept = false
        try {
            setStep('frame')
            const [first, reading] = await Promise.all([
                postApi('/api/v1/lesson-plans/draft', { ...request, step: 'frame' }).then(response => response.data),
                extra({ ...request, step: 'reading' })
            ])
            // kept on this device as soon as the frame is back: a phone that sleeps before the process returns
            // loses only the second half, which 「继续写」 writes again from the saved frame
            const partial = { ...base, meta: { ...base.meta, class_size: settings.classSize, lesson_type: settings.lessonType, class_notes: settings.classNotes, teacher_notes: settings.teacherNotes }, frame: first.frame, process: null, practice: null, reading, evidence: first.evidence, checks: first.checks, model: first.model, privacy: first.privacy, created_at: new Date().toISOString(), partial: true }
            setPlan(partial)
            setStored(writeStored(partial))
            kept = true
            const done = await writeProcess(partial)
            trackUmamiEvent('lesson_plan_drafted', { subject: lesson.subject_slug, indicators: selected.size, risks: done.checks.filter(item => item.level === 'risk').length })
        } catch (errorValue) {
            setError(aiError(errorValue, { drafting: true, kept }))
            setStep('')
        } finally {
            release()
        }
    }

    // 课标解读 and 当堂练习 add to the plan; when one of them fails the plan stands without it
    const extra = step => postApi('/api/v1/lesson-plans/draft', step).then(response => response.data).catch(() => null)

    // the second half of a plan (教学过程 ∥ 当堂练习) from its frame: right after the frame, or to finish a saved draft
    async function writeProcess(current) {
        const request = requestOf(current)
        setStep('process')
        const practiceCall = extra({ ...request, step: 'practice', frame: current.frame })
        const second = await postApi('/api/v1/lesson-plans/draft', { ...request, step: 'process', frame: current.frame }).then(response => response.data)
        // 教学过程 is back and checked; the 当堂练习 call may still be running with its own checks
        setStep('check')
        const practice = await practiceCall
        const { partial: _partial, ...rest } = current
        const done = { ...rest, process: second.process, practice: practice?.practice || null, checks: [...second.checks, ...(practice?.checks || [])], created_at: current.created_at || new Date().toISOString() }
        setPlan(done)
        setStored(writeStored(done))
        setStep('done')
        revealHeading('lp-doc-title')
        return done
    }

    async function continuePlan() {
        if (!plan?.frame || plan.process || step) return
        setError('')
        setTalkError('')
        const release = await keepAwake()
        try {
            await writeProcess(plan)
        } catch (errorValue) {
            setTalkError(aiError(errorValue, { drafting: true, kept: true }))
            setStep('')
        } finally {
            release()
        }
    }

    async function generateUnit() {
        if (!context || !selected.size || selected.size > MAX_POINTS.unit) return
        setError('')
        setCopied(false)
        setUnitPlan(null)
        const lesson = context.lesson
        const lessons = context.unit_lessons || []
        const hours = unitHours || defaultUnitHours(lessons)
        const run = ++unitRunRef.current
        try {
            setStep('unit')
            const payload = (await postApi('/api/v1/lesson-plans/draft', {
                step: 'unit',
                lesson: { title: lesson.title.slice(0, 60), unit_title: (lesson.unit_title || '').slice(0, 60), ...(lesson.textbook_title ? { textbook_title: lesson.textbook_title } : {}), ...(lesson.edition_name ? { edition_name: lesson.edition_name } : {}), subject_slug: lesson.subject_slug, grade: lesson.grade || null },
                indicator_codes: [...selected],
                period_minutes: settings.period,
                class_notes: settings.classNotes,
                teacher_notes: settings.teacherNotes,
                unit_lessons: lessons.map(item => item.title.slice(0, 60)).slice(0, 40),
                unit_hours: hours
            })).data
            if (run !== unitRunRef.current) return
            setUnitPlan({ ...payload, lesson: { ...lesson, subject_name: context.subject_note?.name || subject }, unit_lessons: lessons, hours })
            setStep('done')
            revealHeading('lp-unit-title')
            trackUmamiEvent('unit_plan_drafted', { subject: lesson.subject_slug, lessons: lessons.length })
        } catch (errorValue) {
            if (run !== unitRunRef.current) return
            setError(aiError(errorValue, { drafting: true }))
            setStep('')
        }
    }

    // 说课稿 (说课比赛) or 试讲稿 + 答辩 (教资面试) from the drafted plan
    // a plan written to after a later call: kept with the plan in 最近的草稿, and shown unless another plan replaced it
    function keepPlan(next) {
        setPlan(current => (current && storedKey(current) === storedKey(next) ? next : current))
        setStored(writeStored(next))
    }

    // 说课稿 (说课比赛) or 试讲稿 + 答辩 (教资面试) from the drafted plan, saved with it
    async function makeTalk(step = 'talk') {
        if (!plan?.process || talking) return
        setTalking(step)
        setTalkError('')
        try {
            const lesson = plan.lesson
            const meta = plan.meta || {}
            const payload = (await postApi('/api/v1/lesson-plans/draft', {
                step,
                lesson: { title: lesson.title.slice(0, 60), ...(lesson.unit_title ? { unit_title: lesson.unit_title.slice(0, 60) } : {}), ...(lesson.textbook_title ? { textbook_title: lesson.textbook_title } : {}), ...(lesson.edition_name ? { edition_name: lesson.edition_name } : {}), subject_slug: lesson.subject_slug, grade: lesson.grade || null },
                indicator_codes: plan.evidence.map(item => item.code),
                period_minutes: meta.period_minutes || 40,
                // where the lesson sits, so the script does not say 「第 1 课时（共 1 课时）」 of every lesson
                lesson_index: meta.lesson_index || 1,
                lesson_count: meta.lesson_count || 1,
                ...(meta.class_size ? { class_size: meta.class_size } : {}),
                frame: plan.frame,
                process: plan.process
            })).data
            keepPlan({ ...plan, [step]: payload[step] })
            revealHeading(step === 'trial' ? 'lp-trial-title' : 'lp-talk-title')
            trackUmamiEvent('lesson_plan_export', { format: step, kind: 'lesson' })
        } catch (errorValue) {
            setTalkError(`${step === 'trial' ? '试讲稿' : '说课稿'}没写出来：${aiError(errorValue)}`)
        } finally {
            setTalking('')
        }
    }

    // 当堂练习 once more, when its call failed and the rest of the plan came back
    async function retryPractice() {
        if (!plan?.frame || talking) return
        setTalking('practice')
        setTalkError('')
        try {
            const payload = (await postApi('/api/v1/lesson-plans/draft', {
                step: 'practice',
                lesson: draftLesson(plan.lesson),
                indicator_codes: plan.evidence.map(item => item.code),
                period_minutes: plan.meta?.period_minutes || 40,
                ...(plan.meta?.class_size ? { class_size: plan.meta.class_size } : {}),
                frame: plan.frame
            })).data
            keepPlan({ ...plan, practice: payload.practice, checks: [...plan.checks, ...payload.checks] })
        } catch (errorValue) {
            setTalkError(`当堂练习没写出来：${aiError(errorValue)}`)
        } finally {
            setTalking('')
        }
    }

    async function copy() {
        const done = await copyText(planToText(plan))
        setCopied(done)
        if (done) trackUmamiEvent('lesson_plan_export', { format: 'copy', kind: 'lesson' })
    }

    // a draft from 最近的草稿: shown below whatever lesson is picked, brought into view
    function restore(item) {
        setPlan(item)
        setStep('')
        setError('')
        setTalkError('')
        setCopied(false)
        revealHeading('lp-doc-title')
    }
    function forget(item) {
        setStored(removeStored(item))
    }

    const busy = step === 'frame' || step === 'process' || step === 'check'
    // while any draft runs (a unit design too) the lesson cannot change under it
    const locked = busy || step === 'unit'
    const isUnit = Boolean(context?.unit_lessons?.length)
    const selectedCount = selected.size
    const maxPoints = isUnit ? MAX_POINTS.unit : MAX_POINTS.lesson
    const overMax = selectedCount > maxPoints
    const picking = ai.status === 'loading'
    // for screen readers: one line that says where the draft is
    const status = step === 'frame' ? '正在起草：AI 在写目标、重难点和评价'
        : step === 'process' ? '第 1 步完成，正在写教学过程和当堂练习'
            : step === 'check' ? '教学过程写好了，正在核验'
                : step === 'unit' ? '正在做单元设计'
                    : step === 'done' ? (isUnit ? '单元设计写好了' : '教案写好了') : ''

    return (
        <div className={`container ${styles.page}`}>
            <header className={styles.hero}>
                <p className={styles.kicker}>AI 备课 · 有据可查</p>
                <h1 className={styles.title}>从教材的一课，起草一份有课标依据的教案</h1>
                <p className={styles.lede}>
                    选你下周要教的一课，确认它对应的课标要点，再说说班级情况。AI 只按你勾选的要点写，每条目标都标出依据；写完后程序逐条核对有没有超出课标的限定。约一分钟。
                </p>
                {params.get('check') === '1' ? (
                    <p className={styles.trialNote}>目标体检：先在下面选一课或一个单元，到第 2 步「确认依据」把你写好的学习目标贴进去，逐条对照课标：依据哪条、程度够不够、缺了什么。</p>
                ) : null}
                {params.get('for') === 'trial' ? (
                    <p className={styles.trialNote}>教资面试试讲：先在下面选一课（手边没有教材就选「直接写课题」），起草教案后点「试讲稿 + 答辩」，约 1 分钟生成 10 分钟的试讲稿和 3 道答辩题。</p>
                ) : null}
                {stored.length ? (
                    <details className={`${styles.history} ${styles.historyBox}`} open={!plan}>
                        <summary>最近的草稿（只存在这台设备的浏览器里）{plan ? ` · ${stored.length} 份` : ''}</summary>
                        <ul>
                            {stored.map(item => {
                                const name = `${item.frame?.title || item.lesson?.title}${item.partial ? '（未写完）' : ''}`
                                return (
                                    <li key={storedKey(item)}>
                                        <button type="button" className={styles.restore} aria-current={plan && storedKey(plan) === storedKey(item) ? 'true' : undefined} disabled={locked} onClick={() => restore(item)}>{name}{item.talk || item.trial ? `（含${[item.talk ? '说课稿' : '', item.trial ? '试讲稿' : ''].filter(Boolean).join('、')}）` : ''}<small>{[item.lesson?.subject_name, item.lesson?.grade ? `${item.lesson.grade} 年级` : '', draftDate(item.created_at)].filter(Boolean).join(' · ')}</small></button>
                                        <button type="button" className={styles.historyDelete} disabled={locked} onClick={() => forget(item)}>删除</button>
                                    </li>
                                )
                            })}
                        </ul>
                    </details>
                ) : null}
            </header>

            <section className={styles.step} aria-labelledby="lp-pick">
                <h2 id="lp-pick"><span>1</span>选一课</h2>
                <div className={styles.modeSwitch} role="group" aria-label="选课方式">
                    <button type="button" aria-pressed={!freeMode} disabled={locked} onClick={() => update({ mode: null, topic: null })}>从教材选</button>
                    <button type="button" aria-pressed={freeMode} disabled={locked} onClick={() => update({ mode: 'topic', edition: null, lesson: null, unit: null })}>直接写课题</button>
                </div>
                <div className={styles.pickers}>
                    <label>
                        <span>学科</span>
                        <select value={subject} disabled={locked} onChange={event => update({ subject: event.target.value, edition: null, lesson: null, unit: null, topic: null })}>
                            <option value="">选择学科</option>
                            {(freeMode ? TOPIC_SUBJECTS.map(([name]) => name) : subjects).map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                    </label>
                    {freeMode ? (
                        <>
                            <label>
                                <span>年级（必选）</span>
                                <select value={grade || ''} disabled={locked} onChange={event => update({ grade: event.target.value, topic: null })}>
                                    <option value="">选择年级</option>
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(value => <option key={value} value={value}>{value} 年级</option>)}
                                </select>
                            </label>
                            <label className={styles.wide}>
                                <span>课题</span>
                                <TopicInput value={topic} ready={Boolean(subject && grade) && !locked} onCommit={value => update({ topic: value })} />
                            </label>
                        </>
                    ) : (
                        <>
                            <label>
                                <span>教材</span>
                                <select value={edition} disabled={!subject || locked} onChange={event => update({ edition: event.target.value, lesson: null, unit: null })}>
                                    <option value="">{subject ? '选择年级和册次' : '先选学科'}</option>
                                    {subjectBooks.map(item => <option key={item.edition_id} value={item.edition_id}>{item.edition_name} · {item.grade} 年级{item.volume}</option>)}
                                </select>
                            </label>
                            <label className={styles.wide}>
                                <span>哪一课</span>
                                <select value={chapter ? `chapter::${chapter}` : lessonId} disabled={!edition || !lessons || locked} onChange={event => {
                                    const value = event.target.value
                                    if (value.startsWith('chapter::')) update({ chapter: value.slice('chapter::'.length), lesson: null, unit: null })
                                    else update({ lesson: value, chapter: null, unit: null })
                                }}>
                                    <option value="">{!edition ? '先选教材' : !lessons ? '正在读取目录…' : lessons.failed ? '目录没读到，请刷新页面再试' : lessonGroups.length ? '选择一课，或整个单元' : '这册暂无课时目录，请改用「直接写课题」'}</option>
                                    {lessonGroups.map(group => (
                                        <optgroup key={group.name} label={group.name}>
                                            {/* a 目录 unit with no lessons under it is offered as the one item; there is no unit of lessons to design */}
                                            {group.name !== '其他' && !(group.items.length === 1 && group.items[0].title === group.name) ? <option value={`chapter::${group.name}`}>◆ 整个单元：单元整体设计</option> : null}
                                            {group.items.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
                                        </optgroup>
                                    ))}
                                </select>
                            </label>
                        </>
                    )}
                </div>
                {!freeMode && lessons?.lessons?.length ? <p className={styles.small}>{lessonSource(lessons)}</p> : null}
                {freeMode && topic && !grade ? <p className={styles.small}>先选年级：AI 只读这个年级的课标找要点。</p> : null}
                {!freeMode && lessonGone && !lessonId ? <p className={styles.small} role="status">这本书里没有找到上次那一课（教材换成了最新印次），请重新选一课。</p> : null}
            </section>

            {contextError ? <p className={styles.error} role="alert">{contextError}</p> : null}

            {context ? (
                <section className={styles.step} aria-labelledby="lp-basis">
                    <h2 id="lp-basis"><span>2</span>确认依据</h2>
                    <div className={styles.lessonCard}>
                        <p className={styles.lessonMeta}>{[context.subject_note?.name, context.lesson.grade ? `${context.lesson.grade} 年级` : '', context.lesson.edition_name, context.lesson.textbook_title].filter(Boolean).join(' · ')}</p>
                        <p className={styles.lessonTitle}>{context.lesson.title}</p>
                        {context.lesson.unit_title ? <p className={styles.lessonMeta}>所在单元：{context.lesson.unit_title}</p> : null}
                        {context.lesson.edition_id && context.lesson.pdf_page ? (
                            <Link className={styles.inlineLink} to={`/textbooks/${context.lesson.edition_id}/read?page=${context.lesson.pdf_page}`}>打开原书第 {context.lesson.pdf_page} 页（PDF） <ArrowRightIcon size={14} aria-hidden="true" /></Link>
                        ) : null}
                        <SyncLessons context={context} />
                        <LessonChecks context={context} selected={selected} />
                        <RequiredLabs labs={context.required_labs} />
                    </div>
                    {!isUnit && context.lesson_goals ? (
                        <>
                            <LessonGoals goals={context.lesson_goals} />
                            <p className={styles.small}>写教案时，AI 会以这几条目标为起点，按你勾选的要点和班级情况再调整。</p>
                        </>
                    ) : null}

                    <p className={styles.aiStatus} aria-live="polite">
                        {ai.status === 'loading' ? 'AI 正在把这个年级的课标逐条读一遍，找这一课要教的要点（约 10–20 秒）…'
                            : ai.status === 'ok' ? (isUnit ? `AI 读完了，已勾选这个单元对应的 ${selectedCount} 条要点。请核对：去掉单元里不教的，补上漏掉的。` : `AI 读完了，已勾选它判断直接对应的 ${selectedCount} 条要点。请核对：只留这节课真正要教的（一般 1–3 条）。`)
                                : ai.status === 'closest' ? `AI 没有找到直接对应的要点，先勾了 ${selectedCount} 条最接近的。请读原文核对，或在下面补一句这节课主要教什么，让 AI 重新找。`
                                : ai.status === 'none' ? 'AI 没有找到直接对应的要点。请从下面的候选里自己勾选，或换个课题写法。'
                                    : ai.status === 'lesson' ? `已按这一课的教材原文勾好它主要在教的 ${selectedCount} 条要点（AI 事先逐课读过，每条附这一课的原话）。请核对；想换个角度，在下面补一句，AI 会重新找。`
                                    : ai.status === 'fallback' ? 'AI 这次没能读完要点，先勾上了它此前按整个单元判断的要点：不一定都是这一课教的，请读原文，按这一课增删。'
                                    : ai.status === 'failed' ? 'AI 这次没能读完要点。请读下面候选的原文，自己勾选：机器对齐和字面匹配可能出错，比如会把「分数的基本性质」对到「等式的基本性质」。'
                                    : ai.status === 'manual' ? '可以让 AI 把这个年级的课标读一遍，勾出这一课要教的要点；也可以直接从下面的候选里勾选。' : ''}
                    </p>
                    {ai.status === 'manual' ? <p><button type="button" className="btn btn-secondary" onClick={() => setPickAsked(true)}>让 AI 找要点</button></p> : null}

                    {ai.status !== 'loading' && ai.status !== 'manual' ? <HintInput key={contextQuery} onSubmit={setHint} current={hint} /> : null}

                    <ul className={styles.standards}>
                        {context.standards.map(standard => (
                            <li key={standard.code} className={styles.standard}>
                                <div className={styles.standardHead}>
                                    <Link to={`/standards/${standard.code}`} target="_blank" rel="noopener"><code>{standard.code}</code>{standard.title}</Link>
                                    <span className={styles.via}>{viaLabel[standard.via] || standard.via}</span>
                                    <Link className={styles.graphLink} to={`/knowledge-graph/${subjectOfCode(standard.code)}?focus=${(standard.indicators.find(item => selected.has(item.code)) || standard.indicators[0])?.code || ''}`} target="_blank" rel="noopener">前后联系 ↗</Link>
                                </div>
                                {ai.reasons[standard.code] ? <p className={styles.reason}>AI 判断：{ai.reasons[standard.code]}</p> : null}
                                <ul className={styles.indicators}>
                                    {standard.indicators.map(item => (
                                        <li key={item.code}>
                                            <label className={selected.has(item.code) ? styles.checked : ''}>
                                                <input type="checkbox" checked={selected.has(item.code)} onChange={() => toggle(item.code)} />
                                                <span><code>{item.code.split('.').pop()}</code>{item.text}<small>第 {item.pages.join('、')} 页</small></span>
                                            </label>
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        ))}
                    </ul>
                    {!context.standards.length ? <p className={styles.small}>这一课还没有对齐的课标。等 AI 读完，或改用「直接写课题」。</p> : null}
                    {context.standards.length ? <ObjectiveCheck key={`check:${contextQuery}`}lesson={draftLesson(context.lesson)} codes={[...selected, ...context.standards.flatMap(standard => standard.indicators.map(item => item.code)).filter(code => !selected.has(code))]} taught={[...selected]} isUnit={isUnit} open={params.get('check') === '1'} /> : null}
                    {selectedCount && ai.status !== 'loading' ? <PromptCopy context={context} selected={selected} isUnit={isUnit} settings={settings} unitHours={unitHours || defaultUnitHours(context.unit_lessons)} /> : null}
                </section>
            ) : null}

            {context ? (
                isUnit ? (
                    <section className={styles.step} aria-labelledby="lp-unit">
                        <h2 id="lp-unit"><span>3</span>单元整体设计</h2>
                        <p className={styles.small}>按逆向设计的顺序：先写单元大概念、基本问题和单元目标，再定评价证据（含一个表现性任务），最后把课时排进教材这个单元的 {context.unit_lessons.length} 节课里。</p>
                        <div className={styles.settings}>
                            <label><span>单元总课时</span>
                                <select value={unitHours || defaultUnitHours(context.unit_lessons)} onChange={event => setUnitHours(Number(event.target.value))}>
                                    {Array.from({ length: 30 }, (_, k) => k + 1).map(value => <option key={value} value={value}>{value} 课时</option>)}
                                </select>
                            </label>
                            <label><span>每课时</span>
                                <select value={settings.period} onChange={event => setSettings({ ...settings, period: Number(event.target.value) })}>
                                    {[35, 40, 45].map(value => <option key={value} value={value}>{value} 分钟</option>)}
                                </select>
                            </label>
                        </div>
                        <label className={styles.textarea}>
                            <span>学情</span>
                            <textarea rows={3} maxLength={800} value={settings.classNotes} onChange={event => setSettings({ ...settings, classNotes: event.target.value })} placeholder="班级整体情况。请不要写学生姓名。" />
                        </label>
                        <label className={styles.textarea}>
                            <span>你的想法</span>
                            <textarea rows={3} maxLength={1000} value={settings.teacherNotes} onChange={event => setSettings({ ...settings, teacherNotes: event.target.value })} placeholder="例如：想用一个贯穿单元的真实任务；某两课想合并；学校的实践条件。" />
                        </label>
                        <div className={styles.go}>
                            <button type="button" className="btn btn-primary" disabled={step === 'unit' || !selectedCount || overMax || picking} onClick={generateUnit}>
                                {step === 'unit' ? 'AI 正在做单元设计（约 30–50 秒）…' : picking ? '等 AI 找完要点…' : overMax ? `已选 ${selectedCount} 条要点，最多 ${maxPoints} 条：请去掉 ${selectedCount - maxPoints} 条` : `按选定的 ${selectedCount} 条要点起草单元设计`}
                            </button>
                            {!selectedCount ? <span className={styles.small}>先在上面勾选这个单元依据的要点。</span> : <span className={styles.small}>一个单元最多选 {maxPoints} 条要点。</span>}
                        </div>
                        {error ? <p className={styles.error} role="alert">{error}</p> : null}
                    </section>
                ) : (
                <section className={styles.step} aria-labelledby="lp-class">
                    <h2 id="lp-class"><span>3</span>说说你的情况<small>（可不填）</small></h2>
                    <div className={styles.settings}>
                        <label><span>每课时</span>
                            <select value={settings.period} onChange={event => setSettings({ ...settings, period: Number(event.target.value), periodSet: true })}>
                                {[35, 40, 45].map(value => <option key={value} value={value}>{value} 分钟</option>)}
                            </select>
                        </label>
                        <label><span>本课共</span>
                            <select value={settings.count} onChange={event => setSettings({ ...settings, count: Number(event.target.value), countSet: true, index: Math.min(settings.index, Number(event.target.value)) })}>
                                {[1, 2, 3, 4].map(value => <option key={value} value={value}>{value} 课时</option>)}
                            </select>
                        </label>
                        <label><span>这是第</span>
                            <select value={settings.index} onChange={event => setSettings({ ...settings, index: Number(event.target.value) })}>
                                {Array.from({ length: settings.count }, (_, k) => k + 1).map(value => <option key={value} value={value}>{value} 课时</option>)}
                            </select>
                        </label>
                        <label><span>班额</span>
                            <select value={settings.classSize} onChange={event => setSettings({ ...settings, classSize: Number(event.target.value) })}>
                                {CLASS_SIZES.map(value => <option key={value} value={value}>约 {value} 人</option>)}
                            </select>
                        </label>
                        <label><span>课型</span>
                            <select value={settings.lessonType} onChange={event => setSettings({ ...settings, lessonType: event.target.value })}>
                                <option value="">AI 判断</option>
                                {LESSON_TYPES.map(value => <option key={value} value={value}>{value}</option>)}
                            </select>
                        </label>
                    </div>
                    <label className={styles.textarea}>
                        <span>学情</span>
                        <textarea rows={3} maxLength={800} value={settings.classNotes} onChange={event => setSettings({ ...settings, classNotes: event.target.value })} placeholder="班级整体情况，例如：学生已会用画图表示分数，但说理不清；部分学生计算慢。请不要写学生姓名。" />
                    </label>
                    <p className={styles.quickNotes} aria-label="常用学情，点一下加入">
                        {CLASS_NOTES.map(note => (
                            <button key={note} type="button" onClick={() => setSettings({ ...settings, classNotes: settings.classNotes.includes(note) ? settings.classNotes : [settings.classNotes.trim(), note].filter(Boolean).join('；').slice(0, 800) })}>{note}</button>
                        ))}
                    </p>
                    <label className={styles.textarea}>
                        <span>你的想法</span>
                        <textarea rows={3} maxLength={1000} value={settings.teacherNotes} onChange={event => setSettings({ ...settings, teacherNotes: event.target.value })} placeholder="例如：想用折纸活动导入；重点练习说理；学校没有多媒体。" />
                    </label>
                    <div className={styles.go}>
                        {/* once a plan is on the page, drafting again replaces it: the button says so and steps back */}
                        <button type="button" className={`btn ${plan && !busy ? 'btn-secondary' : 'btn-primary'}`} disabled={busy || !selectedCount || overMax || picking} onClick={generate}>
                            {busy ? '正在起草…' : picking ? '等 AI 找完要点…' : overMax ? `已选 ${selectedCount} 条要点，最多 ${maxPoints} 条：请去掉 ${selectedCount - maxPoints} 条` : plan ? '重新起草（会替换下面的教案）' : `按选定的 ${selectedCount} 条要点起草教案`}
                        </button>
                        {!selectedCount ? <span className={styles.small}>先在上面勾选至少一条要点。</span> : overMax ? <span className={styles.small}>一节课最多选 {maxPoints} 条要点，只留这节课真正要教的。</span> : null}
                    </div>
                    {busy || step === 'done' ? (
                        <ol className={styles.progress}>
                            {STEPS.map(item => {
                                const order = STEPS.findIndex(s => s.key === item.key)
                                const current = STEPS.findIndex(s => s.key === step)
                                const state = step === 'done' || order < current ? 'done' : order === current ? 'active' : 'waiting'
                                return <li key={item.key} data-state={state}><b>{item.label}</b><span>{item.hint}</span><span className="sr-only">{state === 'done' ? '（已完成）' : state === 'active' ? '（进行中）' : '（等待）'}</span></li>
                            })}
                        </ol>
                    ) : null}
                    {error ? <p className={styles.error} role="alert">{error}</p> : null}
                </section>
                )
            ) : null}

            <p className="sr-only" role="status">{status}</p>
            {inWeChat() && ((unitPlan && isUnit) || plan?.process) ? <p className={styles.inAppNote}>微信里不能直接下载：点右上角「···」选「在浏览器打开」，或用「复制全文」</p> : null}
            {unitPlan && isUnit ? <UnitDocument plan={unitPlan} edition={edition} subject={subject} onCopy={async () => setCopied(await copyText(unitToText(unitPlan)))} copied={copied} /> : null}
            {/* the 说课稿/试讲稿/练习 buttons sit at the plan's head; their errors show right above it */}
            {plan && talkError ? <p className={styles.error} role="alert">{talkError}</p> : null}
            {plan ? <PlanDocument plan={plan} done={!busy && Boolean(plan.process)} writing={busy} onCopy={copy} copied={copied} onTalk={makeTalk} talking={talking} onPractice={retryPractice} onContinue={continuePlan} /> : null}
            {plan?.talk ? <TalkScriptView talk={plan.talk} title={plan.frame?.title || plan.lesson.title} /> : null}
            {plan?.trial ? <TrialScriptView trial={plan.trial} title={plan.frame?.title || plan.lesson.title} /> : null}
            <CopyFallback />
        </div>
    )
}

// how many two-character pieces two texts share (「百家争鸣」 and 「“百家争鸣”局面的产生」 share three)
function sharedPairs(a, b) {
    // pairs with function words or 「时期」 match almost anything
    const pairs = text => {
        const chars = [...String(text).replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '')]
        return new Set(chars.slice(0, -1).map((char, index) => char + chars[index + 1]).filter(pair => !/[的和与及等这一了是在]/u.test(pair) && pair !== '时期'))
    }
    const left = pairs(a)
    let shared = 0
    for (const pair of pairs(b)) if (left.has(pair)) shared += 1
    return shared
}

const defaultUnitHours = lessons => Math.min(30, Math.max(1, (lessons || []).reduce((sum, item) => sum + (item.hours || 1), 0)))

function subjectSlugOf(books, subject) {
    const slug = books.find(book => book.subject === subject)?.subject_slug || ''
    return ['art', 'music'].includes(slug) ? 'arts' : slug
}

function HintInput({ onSubmit, current }) {
    const [text, setText] = useState(current)
    return (
        <form className={styles.hint} onSubmit={event => { event.preventDefault(); onSubmit(text.trim()) }}>
            <label htmlFor="lp-hint">没找准？补一句这节课主要教什么，让 AI 重新找</label>
            <span className={styles.topicRow}>
                <input id="lp-hint" type="text" maxLength={80} value={text} onChange={event => setText(event.target.value)} placeholder="例如：借物喻人，体会作者借助具体事物表达道理" />
                <button type="submit" className="btn btn-secondary" disabled={!text.trim() || text.trim() === current}>重新找</button>
            </span>
        </form>
    )
}

// 「找课标」 waits for 学科 and 年级; changing either clears the committed topic but keeps the typed words
function TopicInput({ value, ready, onCommit }) {
    const [text, setText] = useState(value)
    useEffect(() => { if (value) setText(value) }, [value])
    const commit = () => { if (ready && text.trim().length >= 2) onCommit(text.trim()) }
    return (
        <span className={styles.topicRow}>
            <input type="text" value={text} maxLength={60} placeholder="例如：分数的基本性质、浮力、植物的一生" onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') commit() }} />
            <button type="button" className="btn btn-secondary" onClick={commit} disabled={!ready || text.trim().length < 2} title={ready ? undefined : '先选学科和年级'}>找课标</button>
        </span>
    )
}

// where the clipboard is refused, the text to copy, selected in a box at the foot of the screen
function CopyFallback() {
    const [text, setText] = useState('')
    const boxRef = useRef(null)
    useEffect(() => {
        const show = event => setText(String(event.detail || ''))
        window.addEventListener(COPY_FALLBACK_EVENT, show)
        return () => window.removeEventListener(COPY_FALLBACK_EVENT, show)
    }, [])
    useEffect(() => {
        if (!text || !boxRef.current) return
        boxRef.current.focus()
        boxRef.current.select()
    }, [text])
    if (!text) return null
    return (
        <div className={styles.copyFallback} role="dialog" aria-label="手动复制">
            <p role="alert">这个浏览器不让直接复制。下面的文字已全选：长按选「复制」（电脑上按 Ctrl+C）。</p>
            <textarea ref={boxRef} readOnly rows={6} value={text} aria-label="要复制的文字" />
            <button type="button" className="btn btn-secondary" onClick={() => setText('')}>关闭</button>
        </div>
    )
}

const CHECK_ICON = { ok: CheckCircleIcon, warn: WarningIcon, risk: XCircleIcon }
const CHECK_LABEL = { ok: '通过', warn: '提醒', risk: '需改' }
const CHECK_ORDER = { risk: 0, warn: 1, ok: 2 }

// The AI's own ids (O2, A1) read as 「目标 2」「评价 1」: only ids this plan has, only as whole tokens (not CO2, H2O
// or A4纸). In 数学/理科 a bare A1 or O1 is as likely a point, a circle's centre or an ammeter, so there only a bracket
// that holds nothing but ids, as in （A1） or （O1、A2）, is rewritten; in 化学/科学/生物 an O2 is oxygen, so O-ids stay.
// No lookbehind: older iOS WebViews lack it.
const CONTENT_IDS = new Set(['math', 'physics', 'chemistry', 'science', 'biology'])
const ID_TOKEN = /(^|[^A-Za-z0-9])([OA])(\d{1,2})(?![A-Za-z0-9.]|\s*[纸张])/gu
const ID_BRACKET = /[（(]\s*[OA]\d{1,2}(?:\s*[、，,/]\s*[OA]\d{1,2})*\s*[）)]/gu
function idReader(objectives, assessments, subjectSlug) {
    const known = new Set([...(subjectSlug === 'chemistry' || subjectSlug === 'science' || subjectSlug === 'biology' ? [] : objectives || []), ...(assessments || [])].map(item => item.id))
    const swap = text => text.replace(ID_TOKEN, (whole, before, kind, no) => (known.has(kind + no) ? `${before}${kind === 'O' ? '目标' : '评价'} ${no}` : whole))
    const read = CONTENT_IDS.has(subjectSlug) ? text => text.replace(ID_BRACKET, swap) : swap
    return text => (typeof text === 'string' && known.size ? read(text) : text)
}
const objectiveNo = id => id.replace(/^O/u, '')
const assessmentNo = id => id.replace(/^A/u, '')

// 更多: the actions a teacher needs less often, folded so 下载 Word stands out. A plain disclosure (Tab, Enter, Space);
// Escape or a tap outside closes it.
function MoreMenu({ label, children }) {
    const ref = useRef(null)
    useEffect(() => {
        const close = event => { if (ref.current?.open && !ref.current.contains(event.target)) ref.current.open = false }
        document.addEventListener('pointerdown', close)
        return () => document.removeEventListener('pointerdown', close)
    }, [])
    const onKeyDown = event => {
        if (event.key !== 'Escape' || !ref.current?.open) return
        ref.current.open = false
        ref.current.querySelector('summary')?.focus()
    }
    return (
        <details ref={ref} className={styles.more} onKeyDown={onKeyDown}>
            <summary className="btn btn-secondary">{label}</summary>
            <div className={styles.moreMenu}>{children}</div>
        </details>
    )
}

// 本页: one row of links to the plan's sections, so a 15-screen plan on a phone is a tap from 过程 or 作业
function JumpRow({ items }) {
    if (items.length < 2) return null
    return (
        <nav className={styles.jump} aria-label="本页">
            <span>本页</span>
            <ul>{items.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ul>
        </nav>
    )
}

// which 目标 and 评价 a 环节 (or a unit's 课时) serves, in the same words and order in every head
function StageLinks({ objectives, assessments }) {
    return (
        <>
            {objectives?.length ? <span>目标 {objectives.map(objectiveNo).join('、')}</span> : null}
            {assessments?.length ? <span>评价 {assessments.map(assessmentNo).join('、')}</span> : null}
        </>
    )
}

// 评价任务, numbered 评价 1, 2… as the 环节 heads cite them; on a phone each row stacks as a card with its labels
function AssessmentTable({ assessments, say }) {
    return (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="评价任务表">
            <table>
                <thead><tr><th>评价任务</th><th>证据</th><th>达成标准</th><th>对应目标</th></tr></thead>
                <tbody>
                    {assessments.map((item, index) => (
                        <tr key={item.id}>
                            <td data-label="评价任务"><b className={styles.rowNo}>评价 {/^A\d+$/u.test(item.id) ? assessmentNo(item.id) : index + 1}</b>{say(item.task)}</td>
                            <td data-label="证据">{say(item.evidence)}</td>
                            <td data-label="达成标准">{say(item.criteria)}</td>
                            <td data-label="对应目标">{item.objective_ids.length ? `目标 ${item.objective_ids.map(objectiveNo).join('、')}` : ''}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

// a 说课稿 or 试讲稿 lands far below the button that asked for it: bring it into view and put focus on its title
function useArrival(value) {
    const ref = useRef(null)
    useEffect(() => {
        if (!value || !ref.current) return
        ref.current.scrollIntoView({ block: 'start' })
        ref.current.focus({ preventScroll: true })
    }, [value])
    return ref
}

function UnitDocument({ plan, edition, subject, onCopy, copied }) {
    const { unit, lesson, evidence, checks, unit_lessons: lessons, hours } = plan
    const say = idReader(unit.objectives, unit.assessments, lesson.subject_slug)
    // a unit row may join several textbook lessons (「分数的基本性质、约分」); each opens its own lesson plan
    const lessonLink = title => {
        const first = title.split(/[、，,]/u)[0].trim()
        const match = lessons.find(item => item.title === first) || lessons.find(item => item.title.includes(first) || first.includes(item.title))
        return match ? `/lesson-plan?subject=${encodeURIComponent(subject)}&edition=${edition}&lesson=${match.id}` : null
    }
    return (
        <article className={styles.doc} aria-labelledby="lp-unit-title">
            <div className={styles.docActions}>
                <button type="button" className="btn btn-primary" onClick={() => { downloadUnitWord(plan); trackUmamiEvent('lesson_plan_export', { format: 'word', kind: 'unit' }) }}>下载 Word</button>
                <button type="button" className="btn btn-secondary" onClick={onCopy}>{copied ? '已复制' : '复制全文'}</button>
                <button type="button" className="btn btn-secondary" onClick={() => { trackUmamiEvent('lesson_plan_export', { format: 'print', kind: 'unit' }); window.print() }}>打印</button>
                {unit.performance_task?.criteria?.length ? <button type="button" className="btn btn-secondary" title="表现性任务的评价标准排成三级量规，可以先发给学生" onClick={() => { downloadRubricWord(plan); trackUmamiEvent('lesson_plan_export', { format: 'rubric', kind: 'unit' }) }}>评价量规</button> : null}
            </div>
            <header className={styles.docHead}>
                <p className={styles.aiBadge}>AI 起草 · 需老师修改</p>
                <h2 id="lp-unit-title">单元整体设计：{unit.title || lesson.title}</h2>
                <p>{[lesson.subject_name, lesson.grade ? `${lesson.grade} 年级` : '', lesson.textbook_title ? `${lesson.edition_name || ''}${lesson.textbook_title}` : '', `共 ${hours} 课时`].filter(Boolean).join(' · ')}</p>
            </header>
            <section className={styles.checks} aria-label="核验">
                <h3>核验</h3>
                <CheckList checks={checks} />
            </section>
            <section>
                <h3>一、课标依据</h3>
                <ul className={styles.evidence}>
                    {evidence.map(item => <li key={item.code}><Link to={`/standards/${item.standard_code}#${item.code}`} target="_blank" rel="noopener"><code>{item.code}</code></Link>{item.text}<small>修订版第 {item.pages.join('、')} 页</small></li>)}
                </ul>
            </section>
            <section>
                <h3>二、单元大概念与基本问题</h3>
                <p className={styles.core}><b>大概念</b>{unit.big_idea}</p>
                {unit.essential_questions.length ? <ul>{unit.essential_questions.map(item => <li key={item}>{item}</li>)}</ul> : null}
                <p className={styles.small}>什么是大概念、基本问题？见 <Link to="/concepts/big-ideas" target="_blank" rel="noopener">概念词典 · 大概念</Link>、<Link to="/concepts/backward-design" target="_blank" rel="noopener">逆向设计</Link>。</p>
            </section>
            <section>
                <h3>三、单元目标</h3>
                <ol className={styles.objectives}>
                    {unit.objectives.map(item => <li key={item.id}><span>{item.text}</span><span className={styles.basis}><em>{item.kind}</em>{item.basis.map(code => <code key={code}>{code}</code>)}</span></li>)}
                </ol>
            </section>
            {unit.performance_task ? (
                <section>
                    <h3>四、表现性任务：{unit.performance_task.title}</h3>
                    <p><b>情境：</b>{unit.performance_task.scenario}</p>
                    <p><b>学生交出：</b>{unit.performance_task.product}</p>
                    {unit.performance_task.criteria.length ? <ul>{unit.performance_task.criteria.map(item => <li key={item}>{item}</li>)}</ul> : null}
                </section>
            ) : null}
            <section>
                <h3>五、评价任务</h3>
                <AssessmentTable assessments={unit.assessments} say={say} />
            </section>
            <section>
                <h3>六、课时安排（按教材顺序）</h3>
                <ol className={styles.stages}>
                    {unit.lessons.map((item, index) => {
                        const href = lessonLink(item.title)
                        return (
                            <li key={`${item.title}-${index}`}>
                                <div className={styles.stageHead}><b>{item.title}</b><span>{item.hours} 课时</span><StageLinks objectives={item.objective_ids} assessments={item.assessment_ids} /></div>
                                <p>{say(item.focus)}</p>
                                {href ? <Link to={href}>起草这一课的教案 →</Link> : null}
                            </li>
                        )
                    })}
                </ol>
            </section>
            {unit.prior_knowledge.length || unit.connections ? (
                <section>
                    <h3>七、前置知识与前后联系</h3>
                    {unit.prior_knowledge.length ? <p><b>前置知识：</b>{unit.prior_knowledge.join('；')}</p> : null}
                    {unit.connections ? <p><b>前后联系：</b>{unit.connections}</p> : null}
                </section>
            ) : null}
            <p className={styles.docFoot}>本单元设计由 AI{plan.model ? `（${plan.model}）` : ''}依据 kebiao.org 收录的《义务教育课程标准（2022年版2025年修订）》要点起草，课时安排用的是国家平台上这册教材的课目。请结合教材和班级实际修改后使用。</p>
        </article>
    )
}

function TalkScriptView({ talk, title }) {
    const [copied, setCopied] = useState(false)
    const text = [`《${title}》说课稿`, ...talk.sections.flatMap(item => [`${item.heading}`, item.text])].join('\n\n')
    const heading = useArrival(talk)
    return (
        <article className={`${styles.doc} ${styles.script}`} aria-labelledby="lp-talk-title">
            <div className={styles.docActions}>
                <button type="button" className="btn btn-secondary" onClick={async () => setCopied(await copyText(text))}>{copied ? '已复制' : '复制说课稿'}</button>
                <button type="button" className="btn btn-secondary" onClick={() => downloadScriptWord(`《${title}》说课稿`, talk.sections, `${title}-说课稿`)}>下载 Word</button>
            </div>
            <header className={styles.docHead}><p className={styles.aiBadge}>AI 根据上面的教案改写 · 约 {talk.minutes} 分钟</p><h2 id="lp-talk-title" ref={heading} tabIndex={-1}>《{title}》说课稿</h2><p>说课比赛、教师资格面试用。只改写教案已有的内容，没有新增活动。</p></header>
            {talk.sections.map(item => (
                <section key={item.heading}>
                    <h3>{item.heading}</h3>
                    {item.text.split(/\n+/u).map((line, index) => <p key={index}>{line}</p>)}
                </section>
            ))}
        </article>
    )
}

// 教资面试: a 10-minute 试讲 spoken to an empty room, then 答辩
function TrialScriptView({ trial, title }) {
    const [copied, setCopied] = useState(false)
    const text = [`《${title}》试讲稿（约 ${trial.minutes} 分钟）`, ...trial.stages.flatMap(item => [`【${item.name}】约 ${item.minutes} 分钟`, item.text]), trial.board.length ? `板书\n${trial.board.join('\n')}` : '', '答辩', ...trial.defense.flatMap((item, index) => [`${index + 1}. ${item.question}`, item.answer])].filter(Boolean).join('\n\n')
    // （模拟学生回答：……） and （板书：……） stand out from what the teacher says
    const cues = line => line.split(/(（(?:模拟[^：:）]{0,10}|板书)[：:][^）]*）)/u).map((part, index) => (index % 2 ? <span key={index} className={styles.cue}>{part}</span> : part))
    const heading = useArrival(trial)
    return (
        <article className={`${styles.doc} ${styles.script}`} aria-labelledby="lp-trial-title">
            <div className={styles.docActions}>
                <button type="button" className="btn btn-secondary" onClick={async () => setCopied(await copyText(text))}>{copied ? '已复制' : '复制试讲稿'}</button>
                <button type="button" className="btn btn-secondary" onClick={() => downloadScriptWord(`《${title}》试讲稿`, [...trial.stages.map(item => ({ heading: `${item.name}（约 ${item.minutes} 分钟）`, text: item.text })), ...(trial.board.length ? [{ heading: '板书', text: trial.board.join('\n') }] : []), { heading: '答辩准备', text: trial.defense.map((item, index) => `${index + 1}. ${item.question}\n${item.answer}`).join('\n') }], `${title}-试讲稿`)}>下载 Word</button>
            </div>
            <header className={styles.docHead}><p className={styles.aiBadge}>AI 根据上面的教案改写 · 约 {trial.minutes} 分钟</p><h2 id="lp-trial-title" ref={heading} tabIndex={-1}>《{title}》试讲稿</h2><p>教师资格面试用：面对评委模拟上课 10 分钟，再答辩。只改写教案已有的内容。灰色括号里是模拟的学生回答和板书时机。</p></header>
            {trial.stages.map((item, index) => (
                <section key={`${item.name}-${index}`}>
                    <h3>{item.name}<small> · 约 {item.minutes} 分钟</small></h3>
                    {item.text.split(/\n+/u).map((line, lineIndex) => <p key={lineIndex}>{cues(line)}</p>)}
                </section>
            ))}
            {trial.board.length ? <section><h3>板书</h3><pre className={styles.board}>{trial.board.join('\n')}</pre></section> : null}
            <section>
                <h3>答辩准备</h3>
                <ol className={styles.defense}>
                    {trial.defense.map(item => <li key={item.question}><b>{item.question}</b><p>{item.answer}</p></li>)}
                </ol>
            </section>
        </article>
    )
}

// 核验: a count first (通过 n 项 · 提醒 m 项), then what needs a look before what passed, each labelled in words so a
// 提醒 never reads as one more green line
function CheckList({ checks }) {
    const level = item => (CHECK_LABEL[item.level] ? item.level : 'warn')
    const sorted = [...checks].sort((a, b) => CHECK_ORDER[level(a)] - CHECK_ORDER[level(b)])
    const count = key => checks.filter(item => level(item) === key).length
    return (
        <>
            <p className={styles.checkCount}>{['ok', 'warn', 'risk'].filter(count).map(key => `${CHECK_LABEL[key]} ${count(key)} 项`).join(' · ')}</p>
            <ul>
                {sorted.map((item, index) => {
                    const Icon = CHECK_ICON[level(item)]
                    return <li key={`${item.kind}-${index}`} data-level={level(item)}><Icon size={16} aria-hidden="true" /><span><b>{CHECK_LABEL[level(item)]}</b>{item.message}{item.quote ? <small>「{item.quote}」</small> : null}</span></li>
                })}
            </ul>
        </>
    )
}

// For teachers who write with 豆包、DeepSeek or 元宝: the ticked 要点, verbatim with pages, what the teacher said about
// the class, and the rules kebiao's own drafts follow, as one prompt to paste there.
function PromptCopy({ context, selected, isUnit, settings, unitHours }) {
    const [copied, setCopied] = useState(false)
    const lesson = context.lesson
    const points = context.standards.flatMap(standard => standard.indicators.filter(item => selected.has(item.code)))
    const period = settings?.period || 40
    const what = isUnit ? '单元整体教学设计（单元大概念、基本问题、单元目标、表现性任务、课时安排）' : `一份 ${period} 分钟的教案`
    const unitLessons = context.unit_lessons || []
    // kebiao's 课堂学习目标 for this lesson, the starting point its own draft uses
    const goals = !isUnit ? context.lesson_goals?.items || [] : []
    const situation = [
        isUnit ? `课时：教材里本单元的课是${unitLessons.map(item => `「${item.title}」`).join('、')}，共 ${unitHours} 课时，每课时 ${period} 分钟。` : `课时：本课共 ${settings.count} 课时，这是第 ${Math.min(settings.index, settings.count)} 课时，${period} 分钟。`,
        !isUnit && settings.lessonType ? `课型：${settings.lessonType}。` : '',
        settings.classNotes?.trim() ? `班级情况：${settings.classNotes.trim()}` : '',
        settings.teacherNotes?.trim() ? `老师的想法：${settings.teacherNotes.trim()}` : ''
    ].filter(Boolean)
    const rules = isUnit ? [
        '1. 先写「单元课标分析」：这些要点要学生做到什么，本单元承担哪一部分，单元里的课怎样分工落实。',
        '2. 写单元大概念 1 条、基本问题 2–3 个。',
        '3. 单元目标 3–5 条，每条以「学生能」开头，写清条件、行为和程度，并在括号里注明依据的要点编码。',
        '4. 先定评价证据：一个贯穿单元的表现性任务（情境、学生要交的成果、分级评价标准），再写每条目标看什么证据。',
        '5. 课时安排：按上面的课时数把课排进教材本单元的课，每课时写教学重点和推进哪几条目标；作业符合「双减」要求。',
        '6. 要点里写明「不包括」「不要求」的内容不要出现；只用上面的要点编码，不要编造课标编码或原文。'
    ] : [
        '1. 先写「课标分析」：逐条说清这条要点要学生做到什么，关键行为词（如「理解」「运用」）要求到什么程度，本课承担哪一部分，怎样用教材去落实它（不要只把教材讲一遍）。',
        `2. 教学目标 2–4 条，每条以「学生能」开头，写清条件、行为和程度，用看得见的动词，并在括号里注明依据的要点编码。${goals.length ? '可以从下面已写好的课堂学习目标出发调整。' : ''}`,
        '3. 先写评价任务（每条目标至少对应一个），再写教学过程（环节、时间、组织形式、教师活动、学生活动、关键问题与预设回答、设计意图），每个环节注明推进哪条目标。',
        `4. 按常规大班设计（约 ${settings?.classSize || 45} 人，按排就座，一位老师）：以讲解和示范为主线，讲之前留 1–3 分钟让学生先想、先试，再同桌交流；小组活动一节课最多 2 次；写清老师怎样看到全班学会没有，不要只靠举手。`,
        '5. 附当堂练习与检测题（基础、变式、提高）和参考答案；作业分层并写预计用时，符合「双减」要求。',
        '6. 要点里写明「不包括」「不要求」的内容不要出现；只用上面的要点编码，不要编造课标编码或原文。'
    ]
    const text = [
        `请你作为${context.subject_note?.name || ''}教研员，依据下面的课程标准要点，为${[lesson.edition_name, lesson.textbook_title].filter(Boolean).join('')}${lesson.textbook_title ? '的' : ''}「${lesson.title}」${lesson.grade ? `（${lesson.grade} 年级）` : ''}写${what}。`,
        '',
        '课标依据（《义务教育课程标准（2022年版2025年修订）》原文）：',
        ...points.map(item => `- ${item.code}：${item.text}（修订版第 ${item.pages.join('、')} 页）`),
        ...(goals.length ? ['', 'kebiao 已为这一课写好的课堂学习目标（可作起点）：', ...goals.map(([goal, basis]) => `- ${goal}（依据 ${basis.join('、')}）`)] : []),
        '',
        '班级与课时：',
        ...situation.map(line => `- ${line}`),
        '',
        '要求：',
        ...rules
    ].join('\n')
    async function copy() {
        const done = await copyText(text)
        setCopied(done)
        if (done) trackUmamiEvent('lesson_plan_export', { format: 'prompt', kind: isUnit ? 'unit' : 'lesson' })
    }
    return (
        <div className={styles.promptCopy}>
            <button type="button" className="btn btn-secondary" onClick={copy}>{copied ? '已复制，去粘贴吧' : '复制成提示词'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { downloadSkeletonWord(context, selected); trackUmamiEvent('lesson_plan_export', { format: 'skeleton', kind: isUnit ? 'unit' : 'lesson' }) }}>{isUnit ? '下载单元设计框架' : '下载教案框架'}</button>
            <span>用豆包、DeepSeek 写？复制勾好的 {points.length} 条要点和写法要求；或下载{isUnit ? '单元设计框架，课标依据和单元里的课已填好' : '教案框架，课标依据已填好'}。</span>
        </div>
    )
}

// 国家平台同步课, one line under the lesson: this lesson's own when the platform has it, else its unit's first few
// 课堂诊断题 that fit this lesson: one question to project at the start or end of the lesson
function LessonChecks({ context, selected }) {
    const [bank, setBank] = useState(null)
    const slug = subjectBySlug(context.lesson.subject_slug)?.slug || ''
    useEffect(() => {
        setBank(null)
        if (!slug) return undefined
        let active = true
        loadBank(slug).then(value => { if (active) setBank(value) }).catch(() => {})
        return () => { active = false }
    }, [slug])
    if (!slug || !bank) return null
    // a 语文 or 英语 question is about one text: only questions about this lesson's text are offered
    const items = questionsForLesson(bank, { grade: context.lesson.grade, title: context.lesson.title, chapters: [context.lesson.unit_title || ''], points: [...selected], sameText: ['chinese', 'english'].includes(slug) }).slice(0, 3)
    if (!items.length) return null
    const back = `${window.location.pathname}${window.location.search}`
    return (
        <p className={styles.sync}>
            <span>课堂诊断题</span>
            {items.map(item => <Link key={item.id} to={presentHref([item.id], { back })}>{item.topic}</Link>)}
            <small>上课先问一道，全班手势作答 · <Link to={presentHref(items.map(item => item.id), { title: context.lesson.title, back })}>连着放映</Link></small>
        </p>
    )
}

// 学生必做实验 the 课标 lists for this lesson: the plan has the students do it, not only watch a demonstration
function RequiredLabs({ labs }) {
    if (!labs?.length) return null
    return (
        <p className={styles.sync}>
            <span>学生必做实验</span>
            {labs.map(lab => <Link key={lab.text} to="/experiments">{lab.text}</Link>)}
            <small>{[labs.map(lab => [lab.code, lab.page ? `课标第 ${lab.page} 页` : ''].filter(Boolean).join(' · ')).join('；'), '课标要求学生亲手做，教案会安排分组实验'].filter(Boolean).join(' · ')}</small>
        </p>
    )
}

function SyncLessons({ context }) {
    const own = context.national_lessons.filter(item => item.id === context.lesson.lesson_id)
    const lessons = own.length ? own : context.national_lessons.slice(0, 5)
    if (!lessons.length) return null
    const materials = own.length ? MATERIAL_ORDER.filter(name => own[0].materials.includes(name)) : []
    return (
        <p className={styles.sync}>
            <span>国家平台同步课</span>
            {lessons.map(item => <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer">{item.title}<ArrowUpRightIcon size={13} aria-hidden="true" /></a>)}
            <small>{[materials.join('、'), '免费，观看需登录', context.national_confidence === 'edition' ? '版本可能和你手上的不同' : ''].filter(Boolean).join(' · ')}</small>
        </p>
    )
}

function PlanDocument({ plan, done, writing, onCopy, copied, onTalk, talking, onPractice, onContinue }) {
    const { lesson, frame, process, practice, reading, evidence, checks, meta } = plan
    const article = useRef(null)
    const say = idReader(frame?.objectives, frame?.assessments, lesson.subject_slug)
    const metaLine = [lesson.subject_name, lesson.grade ? `${lesson.grade} 年级` : '', lesson.textbook_title ? `${lesson.edition_name || ''}${lesson.textbook_title}` : '', meta ? `第 ${meta.lesson_index} 课时（共 ${meta.lesson_count} 课时）· ${meta.period_minutes} 分钟` : '', meta?.class_size ? `约 ${meta.class_size} 人` : '', meta?.lesson_type || ''].filter(Boolean).join(' · ')
    const hasPractice = Boolean(practice?.items?.length || (process && done && onPractice))
    const jump = [
        ['lp-sec-standards', '课标分析', true], ['lp-sec-objectives', '目标', frame], ['lp-sec-keys', '重难点', frame], ['lp-sec-learners', '学情', frame],
        ['lp-sec-assessments', '评价', frame], ['lp-sec-process', '过程', process], ['lp-sec-practice', '练习', hasPractice],
        ['lp-sec-board', '板书', process?.board.length], ['lp-sec-homework', '作业', process?.homework.length]
    ].filter(item => item[2])
    // printed, the plan reads like its Word file: every 参考答案 and the 课标原文 open (closed again after)
    useEffect(() => {
        const opened = []
        const before = () => article.current?.querySelectorAll('section details:not([open])').forEach(item => { item.open = true; opened.push(item) })
        const after = () => {
            opened.splice(0).forEach(item => { item.open = false })
            delete document.documentElement.dataset.lpPrint
        }
        window.addEventListener('beforeprint', before)
        window.addEventListener('afterprint', after)
        return () => {
            window.removeEventListener('beforeprint', before)
            window.removeEventListener('afterprint', after)
        }
    }, [])
    // 打印 here prints this plan alone, without a 说课稿 or 试讲稿 drafted below it
    const print = () => {
        trackUmamiEvent('lesson_plan_export', { format: 'print', kind: 'lesson' })
        document.documentElement.dataset.lpPrint = 'plan'
        window.print()
    }
    return (
        <article ref={article} className={styles.doc} aria-labelledby="lp-doc-title">
            {done ? (
                // each label is one inline span: a flex button would otherwise read 「下载 Word （详案）」 with a space
                <div className={styles.docActions}>
                    <button type="button" className="btn btn-primary" onClick={() => { downloadWord(plan); trackUmamiEvent('lesson_plan_export', { format: 'word', kind: 'lesson' }) }}><span>下载 Word<span className={styles.extra}>（详案）</span></span></button>
                    <button type="button" className="btn btn-secondary" title="一页纸：环节、时间、关键问题、练习和板书，带进课堂用" onClick={() => { downloadBriefWord(plan); trackUmamiEvent('lesson_plan_export', { format: 'brief', kind: 'lesson' }) }}><span>简案<span className={styles.extra}>（上课用）</span></span></button>
                    <button type="button" className="btn btn-secondary" onClick={onCopy}>{copied ? '已复制' : <span>复制<span className={styles.extra}>全文</span></span>}</button>
                    <MoreMenu label={<>更多{talking === 'talk' || talking === 'trial' ? ' · 正在写…' : ''}</>}>
                        <button type="button" className="btn btn-ghost" onClick={print}>打印</button>
                        {onTalk ? (
                            <>
                                <small>AI 改写，约 20 秒</small>
                                <button type="button" className="btn btn-ghost" onClick={() => onTalk('talk')} disabled={Boolean(talking)}>{talking === 'talk' ? '正在写说课稿…' : '生成说课稿'}</button>
                                <button type="button" className="btn btn-ghost" onClick={() => onTalk('trial')} disabled={Boolean(talking)}>{talking === 'trial' ? '正在写试讲稿…' : '试讲稿 + 答辩'}</button>
                            </>
                        ) : null}
                        <small>下载表格</small>
                        <button type="button" className="btn btn-ghost" title="按这份教案的目标、评价和环节生成，供听课、评课、磨课时填写" onClick={() => { downloadObservationWord(plan); trackUmamiEvent('lesson_plan_export', { format: 'observation', kind: 'lesson' }) }}>听课观察表</button>
                        <button type="button" className="btn btn-ghost" title="按这份教案的目标、证据和预设难点生成，上完课填写" onClick={() => { downloadReflectionWord(plan); trackUmamiEvent('lesson_plan_export', { format: 'reflection', kind: 'lesson' }) }}>课后反思表</button>
                    </MoreMenu>
                </div>
            ) : null}
            <header className={styles.docHead}>
                <p className={styles.aiBadge}>AI 起草 · 需老师修改</p>
                <h2 id="lp-doc-title">{frame?.title || lesson.title}</h2>
                <p>{metaLine}</p>
            </header>
            <JumpRow items={jump} />

            {checks?.length ? (
                <section className={styles.checks} aria-label="核验">
                    <h3>核验{done ? '' : <small>（教学过程写完后再核一次）</small>}</h3>
                    <CheckList checks={checks} />
                </section>
            ) : null}

            <StandardReading evidence={evidence} reading={reading} core={frame?.core_understanding} />

            {frame ? (
                <>
                    <section id="lp-sec-objectives">
                        <h3>二、教学目标</h3>
                        <ol className={styles.objectives}>
                            {frame.objectives.map(item => (
                                <li key={item.id}>
                                    <span>{say(item.text)}</span>
                                    <span className={styles.basis}><em>{item.kind}</em>{item.basis.map(code => <code key={code}>{code}</code>)}</span>
                                </li>
                            ))}
                        </ol>
                    </section>
                    <section id="lp-sec-keys">
                        <h3>三、教学重点与难点</h3>
                        <div className={styles.twoCol}>
                            <div><h4>教学重点</h4><ul>{frame.key_points.map(text => <li key={text}>{say(text)}</li>)}</ul></div>
                            <div><h4>教学难点</h4><ul>{frame.difficult_points.map(text => <li key={text}>{say(text)}</li>)}</ul></div>
                        </div>
                        {frame.strategies?.length ? <p className={styles.strategies}><b>突破难点：</b>{say(frame.strategies.join('；'))}</p> : null}
                    </section>
                    <section id="lp-sec-learners">
                        <h3>四、学情分析</h3>
                        <p>{say(frame.learner_analysis)}</p>
                        {frame.prior_knowledge.length ? <p><b>前置知识：</b>{frame.prior_knowledge.join('；')}</p> : null}
                        {frame.misconceptions.length ? (
                            <dl className={styles.misconceptions}>
                                {frame.misconceptions.map(item => <div key={item.text}><dt>常见误解：{item.text}</dt><dd>应对：{say(item.response)}</dd></div>)}
                            </dl>
                        ) : null}
                        {frame.keywords.length ? <p><b>关键词：</b>{frame.keywords.map(item => `${item.term}（${item.definition}）`).join('；')}</p> : null}
                    </section>
                    <section id="lp-sec-assessments">
                        <h3>五、评价任务</h3>
                        <AssessmentTable assessments={frame.assessments} say={say} />
                    </section>
                </>
            ) : null}

            {process ? (
                <>
                    {process.materials.length || process.safety.length ? (
                        <section>
                            <h3>六、教学准备</h3>
                            {process.materials.length ? <p>{process.materials.join('、')}</p> : null}
                            {process.safety.length ? <p className={styles.safety}><b>安全提示：</b>{process.safety.join('；')}</p> : null}
                        </section>
                    ) : null}
                    <section id="lp-sec-process">
                        <h3>七、教学过程</h3>
                        <ol className={styles.stages}>
                            {process.stages.map((stage, index) => (
                                <li key={`${stage.name}-${index}`}>
                                    <div className={styles.stageHead}><b>{stage.name}</b><span>{stage.minutes} 分钟</span>{stage.org ? <span className={styles.org}>{stage.org}</span> : null}<StageLinks objectives={stage.objective_ids} assessments={stage.assessment_ids} /></div>
                                    <dl>
                                        <div><dt>教师活动</dt><dd>{say(stage.teacher)}</dd></div>
                                        <div><dt>学生活动</dt><dd>{say(stage.students)}</dd></div>
                                        {stage.questions?.length ? (
                                            <div><dt>关键问题</dt><dd>
                                                <ul className={styles.questions}>
                                                    {stage.questions.map(item => (
                                                        <li key={item.q}>
                                                            <span><b>问</b>{item.q}</span>
                                                            {item.expect ? <span><b>预设</b>{item.expect}</span> : null}
                                                            {item.follow ? <span><b>追问</b>{item.follow}</span> : null}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </dd></div>
                                        ) : null}
                                        {stage.check ? <div><dt>看全班</dt><dd>{say(stage.check)}</dd></div> : null}
                                        {stage.support ? <div><dt>照顾差异</dt><dd>{say(stage.support)}</dd></div> : null}
                                        <div><dt>设计意图</dt><dd>{say(stage.purpose)}</dd></div>
                                    </dl>
                                </li>
                            ))}
                        </ol>
                    </section>
                    {practice?.items?.length ? (
                        <section id="lp-sec-practice">
                            <h3>八、当堂练习与检测</h3>
                            <ol className={styles.practice}>
                                {practice.items.map((item, index) => (
                                    <li key={`${item.question}-${index}`}>
                                        <div className={styles.practiceHead}><span data-kind={item.kind}>{item.kind}</span><span>{item.level}</span>{item.code ? <Link to={`/standards/${item.code.replace(/\.\d+$/u, '')}#${item.code}`} target="_blank" rel="noopener"><code>{item.code}</code></Link> : null}</div>
                                        <p>{say(item.question)}</p>
                                        <details><summary>参考答案</summary><p>{say(item.answer)}</p></details>
                                    </li>
                                ))}
                            </ol>
                            <p className={styles.small}>题目和答案由 AI 起草，课前请核对后再用。</p>
                        </section>
                    ) : done && onPractice ? (
                        <section id="lp-sec-practice">
                            <h3>八、当堂练习与检测</h3>
                            <p className={styles.small}>这次没写出当堂练习。 <button type="button" className="btn btn-ghost" onClick={onPractice} disabled={Boolean(talking)}>{talking === 'practice' ? '正在写当堂练习…' : '再写一次'}</button></p>
                        </section>
                    ) : null}
                    {process.board.length ? <section id="lp-sec-board"><h3>九、板书设计</h3><pre className={styles.board}>{process.board.map(say).join('\n')}</pre></section> : null}
                    {process.homework.length ? <section id="lp-sec-homework"><h3>十、作业设计</h3><ul>{process.homework.map(item => <li key={item.task}><b>【{item.level}】</b>{say(item.task)}{item.minutes ? <small className={styles.minutes}>约 {item.minutes} 分钟</small> : null}</li>)}</ul></section> : null}
                </>
            ) : frame ? (writing ? <p className={styles.small}>正在写教学过程和当堂练习…</p> : (
                <section>
                    <h3>七、教学过程</h3>
                    <p className={styles.small}>教学过程和当堂练习还没写完（常见原因：手机锁屏或切到别的应用，网络中断）。上面的目标和评价已经存在这台设备上。</p>
                    {onContinue ? <button type="button" className="btn btn-primary" onClick={onContinue}>继续写教学过程和当堂练习</button> : null}
                </section>
            )) : null}

            <p className={styles.docFoot}>本教案由 AI{plan.model ? `（${plan.model}）` : ''}依据 kebiao.org 收录的《义务教育课程标准（2022年版2025年修订）》要点起草，按常规大班课堂设计：以讲解示范为主线，讲之前让学生先想先试，讲之后练习反馈。课标原文以官方出版物为准；请结合教材和班级实际修改后使用。{plan.privacy?.redacted ? ' 你填写的内容里有可识别的个人信息，发送前已移除。' : ''}</p>
        </article>
    )
}

// 一、课标分析: each 要点 as the 课标 says it, then read for the teacher (what it asks, how far this lesson goes, how to use
// the textbook for it, what to avoid) with what comes before and after it and where this book teaches it. Without a
// reading (AI failed, or an older draft) it is the 课标依据 list it always was.
function StandardReading({ evidence, reading, core }) {
    const points = new Map((reading?.reading?.points || []).map(item => [item.code, item]))
    const links = new Map((reading?.links || []).map(item => [item.code, item]))
    const standards = reading?.standards || []
    const linkText = item => <><Link to={`/standards/${item.code.replace(/\.\d+$/u, '')}#${item.code}`} target="_blank" rel="noopener"><code>{item.code}</code></Link>{item.grade ? `（${item.grade}）` : ''}{item.text.length > 34 ? `${item.text.slice(0, 34)}…` : item.text}{item.reason ? <small>——{item.reason}</small> : null}</>
    return (
        <section id="lp-sec-standards">
            <h3>一、课标分析</h3>
            <ul className={styles.evidence}>
                {evidence.map(item => {
                    const point = points.get(item.code)
                    const link = links.get(item.code)
                    return (
                        <li key={item.code}>
                            <Link to={`/standards/${item.standard_code}#${item.code}`} target="_blank" rel="noopener"><code>{item.code}</code></Link>{item.text}<small>修订版第 {item.pages.join('、')} 页 · {item.stage_label}</small>
                            {point || link?.before.length || link?.after.length || link?.in_book.length ? (
                                <dl className={styles.reading}>
                                    {point?.plain ? <div><dt>要做到</dt><dd>{point.plain}</dd></div> : null}
                                    {point?.verbs.length ? <div><dt>关键词</dt><dd>{point.verbs.map(verb => <span key={verb.word} className={styles.verb}><b>{verb.word}</b>{verb.meaning}</span>)}</dd></div> : null}
                                    {point?.this_lesson ? <div><dt>本课承担</dt><dd>{point.this_lesson}</dd></div> : null}
                                    {point?.textbook ? <div><dt>用教材教</dt><dd>{point.textbook}</dd></div> : null}
                                    {point?.avoid ? <div><dt>注意</dt><dd>{point.avoid}</dd></div> : null}
                                    {link?.before.length ? <div><dt>先学</dt><dd><ul className={styles.links}>{link.before.map(entry => <li key={entry.code}>{linkText(entry)}</li>)}</ul></dd></div> : null}
                                    {link?.after.length ? <div><dt>后学</dt><dd><ul className={styles.links}>{link.after.map(entry => <li key={entry.code}>{linkText(entry)}</li>)}</ul></dd></div> : null}
                                    {link?.in_book.length ? <div><dt>本册在哪教</dt><dd>{link.in_book.map(entry => `${entry.lesson}${entry.current ? '（本课）' : ''}${entry.page ? `（PDF ${entry.page}）` : ''}`).join('；')}{link.books > 1 ? <small>　另有 {link.books - 1} 本教材也教它</small> : null}</dd></div> : null}
                                </dl>
                            ) : null}
                        </li>
                    )
                })}
            </ul>
            {reading?.reading?.position ? <p className={styles.core}><b>这节课的位置</b>{reading.reading.position}</p> : null}
            {core ? <p className={styles.core}><b>核心理解</b>{core}</p> : null}
            {reading?.reading?.literacy?.length ? <p className={styles.core}><b>素养表现</b>{reading.reading.literacy.map(item => `${item.name}：${item.look_for}`).join('；')}</p> : null}
            {reading?.limits?.length ? <p className={styles.limits}><b>课标限定</b>{reading.limits.join('；')}——这些内容本课不教、不考。</p> : null}
            {standards.some(item => item.requirements.length || item.guidance.length) ? (
                <details className={styles.standardText}>
                    <summary>课标原文：所在标准、学业要求、教学提示</summary>
                    {standards.map(item => (
                        <div key={item.code}>
                            <p><b>{item.code} {item.title}</b>（{item.stage_label}）{item.statement ? `：${item.statement}` : ''}{item.statement_source === 'kebiao_summary' ? <small>（kebiao 概括）</small> : null}</p>
                            {item.requirements.length ? <p><b>学业要求</b>{item.requirements.join(' ')}</p> : null}
                            {item.guidance.length ? <p><b>教学提示</b>{item.guidance.join(' ')}</p> : null}
                        </div>
                    ))}
                </details>
            ) : null}
            {reading && !reading.reading ? <p className={styles.small}>这次 AI 没有写出课标解读；上面是课标原文和前后联系。</p> : null}
        </section>
    )
}
