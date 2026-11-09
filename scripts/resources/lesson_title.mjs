// Does a page's text carry a lesson's title? Shared by extract_lesson_text.mjs (to find and confirm a lesson's first page)
// and check_lesson_text.mjs (to measure how often the extracted text is the lesson's own).
// Chinese titles: the title's words, with the lesson number, 课时, (节选) and music verbs like 欣赏/演唱 taken off, and the
// page's pinyin taken out. English titles: the unit or module number and part letter apart, then the activity's words.

// pinyin, including the 一年级 books' font that writes tone vowels as capitals (huG, hYng)
const LATIN = /[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüɑɡ]+/gu
const NUMBER = '[一二三四五六七八九十百零\\d]+'

// The page's text as titles are matched against it: English as spaced words; Chinese without spaces, punctuation and
// (when the title has no Latin letters) pinyin
export function pageKey(text, kind, keepLatin = false) {
    const raw = String(text || '')
    if (kind === 'en') return ` ${raw.toLowerCase().replace(/[’'`]/gu, '').replace(/[^a-z0-9]+/gu, ' ').trim()} `
    return (keepLatin ? raw : raw.replace(LATIN, '')).replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
}

const EN_STOP = new Set(['the', 'and', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'it', 'then', 'about', 'your', 'you'])
const enPhrase = text => {
    const phrase = String(text).toLowerCase().replace(/'/gu, '').split(/[^a-z0-9]+/u).filter(Boolean)
    const words = phrase.filter(word => word.length > 1 && !EN_STOP.has(word) && !/^\d+$/u.test(word))
    return { phrase: phrase.join(' '), short: phrase.length <= 4, words: [...new Set(words)] }
}

export function titleKeys(title, subject) {
    const text = String(title || '').replace(/\s+/gu, ' ').trim()
    if (subject === '英语' || (/^[\x20-\x7e’‘“”—–]+$/u.test(text) && /[a-z]{3}/iu.test(text))) {
        let rest = text.replace(/[’‘`]/gu, "'")
        const unitMatch = rest.replace(/_/gu, ' ').match(/\b(unit|module)\s*(\d+)\b/iu)
        const unit = unitMatch ? { word: unitMatch[1].toLowerCase(), n: Number(unitMatch[2]) } : null
        // the book section the activity sits in: "Unit 3 Yummy food (Fuel up)", "Unit 5_Fuel up_1 Listen and chant."
        let section = null
        const paren = rest.match(/[（(]([^)）]*)[)）]/u)
        if (paren) { section = paren[1].split(/&|,/u)[0]; rest = rest.replace(paren[0], ' ') }
        if (rest.includes('_')) {
            const parts = rest.split('_').map(part => part.replace(/^\s*\d+\s+/u, '').trim()).filter(part => part && !/^(?:starter\s+)?(?:unit|module)\s*\d+$/iu.test(part))
            if (parts.length >= 2) section = section || parts.at(-2)
            rest = `${unitMatch ? unitMatch[0] : ''} ${parts.at(-1) || ''}`
        }
        rest = rest.replace(/\b(?:starter\s+)?(?:unit|module)\s*\d+\b/giu, ' ')
        let part = null
        const partMatch = rest.match(/\b(?:part|section)\s*([abc])\b/iu) || rest.match(/^\s*([ABC])\b(?!')/u)
        if (partMatch) { part = partMatch[1].toUpperCase(); rest = rest.replace(partMatch[0], ' ') }
        rest = rest.replace(/\b(?:recycle|revision|starter|review)\s*\d*\b/giu, ' ')
        return { kind: 'en', unit, part, ...enPhrase(rest), section: section && enPhrase(section).words.length ? enPhrase(section) : null }
    }
    // "第二单元-因数和倍数-质数和合数", "圆柱与圆锥_圆柱的表面积练习（二）": the last part is the lesson's own
    const parts = text.split(/_|(?<=[\u3400-\u9fff）)])\s*-\s*(?=[\u3400-\u9fff\d])/u).map(part => part.trim()).filter(Boolean)
    let core = (parts.at(-1) || text)
        .replace(/[（(][^）)]*(?:课时|节选|讲评|竖笛|口风琴|水平[一二三四])[^）)]*[）)]/gu, '')
        .replace(/水平[一二三四]$/u, '')
        .replace(new RegExp(`^(?:第\\s*${NUMBER}\\s*(?:单元|章|节|课)|课题\\s*\\d+|\\d+(?:\\.\\d+)*\\s*\\*?\\.?|[一二三四五六七八九十]+[、.])\\s*`, 'u'), '')
        .replace(/^(?:欣赏|演唱|演奏|聆听|唱歌|歌曲|表演|编创|学唱|唱|听)[：:\s]*/u, '')
    // a practice or review lesson of a topic: the topic ("比例尺练习", "分数的意义和性质单元整理（一）", "锐角三角函数1")
    const numbered = core.replace(/\s*(?:[（(][一二三四五六七八九十\d]+[）)]|\d+)\s*$/u, '')
    const topic = numbered.replace(/(?:单元)?(?:整理和复习|整理与复习|整理|复习|的练习|练习)$/u, '')
    const practice = topic !== numbered && pageKey(topic, 'zh').length >= 2
    if (practice) core = topic
    else if (pageKey(numbered, 'zh').length >= 2) core = numbered
    const keepLatin = /[a-z]/iu.test(core)
    const tokens = core.split(/[\s\p{P}\p{S}]+|(?<=[㐀-鿿])及(?=[㐀-鿿])/u)
        .map(token => pageKey(token, 'zh', keepLatin).replace(/^[及和与]/u, '')).filter(token => token.length >= 2)
    return { kind: 'zh', keepLatin, practice, core: pageKey(core, 'zh', keepLatin), tokens: [...new Set(tokens)] }
}

// true / false, or null when the title has nothing to look for. A short English title must be on the page as written
// ("Let's talk"); a longer one needs most of its words.
export function titleOnPage(keys, text) {
    if (keys.kind === 'en') {
        if (!keys.words.length) return null
        const page = pageKey(text, 'en')
        // "Fuel up" may be printed "Fuelup"
        if (keys.short) return page.includes(` ${keys.phrase} `) || (keys.phrase.includes(' ') && page.replace(/ /gu, '').includes(keys.phrase.replace(/ /gu, '')))
        return keys.words.filter(word => page.includes(` ${word} `)).length / keys.words.length >= 0.7
    }
    if (!keys.tokens.length) return null
    const page = pageKey(text, 'zh', keys.keepLatin)
    if (keys.core && page.includes(keys.core)) return true
    return keys.tokens.every(token => page.includes(token))
}

// where on the page the title starts (index into the page key), or -1: a lesson's own first page has it near the top
export function titleAt(keys, text) {
    if (keys.kind === 'en') return titleOnPage(keys, text) ? 0 : -1
    if (!keys.tokens.length) return -1 // 「z c s」: too short to find
    const page = pageKey(text, 'zh', keys.keepLatin)
    if (keys.core && page.includes(keys.core)) return page.indexOf(keys.core)
    return keys.tokens.length && keys.tokens.every(token => page.includes(token)) ? Math.max(...keys.tokens.map(token => page.indexOf(token))) : -1
}
