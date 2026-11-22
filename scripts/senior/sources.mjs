// 高中课标 (普通高中课程标准 2017年版2020年修订): the 15 PDFs kebiao reads, one per file key.
export const PDF_DIR = process.env.SENIOR_PDF_DIR || '/Volumes/X9 Pro/kebiao-incoming/2026-11-22-senior-standards/pdf'
export const SOURCES = [
    { key: 'chinese', no: 2, name: '语文', graph: 'chinese', prefix: 'CN' },
    { key: 'math', no: 3, name: '数学', graph: 'math', prefix: 'MA' },
    { key: 'english', no: 4, name: '英语', graph: 'english', prefix: 'EN' },
    { key: 'politics', no: 5, name: '思想政治', graph: 'morality_law', prefix: 'ML' },
    { key: 'history', no: 6, name: '历史', graph: 'history', prefix: 'HI' },
    { key: 'geography', no: 7, name: '地理', graph: 'geography', prefix: 'GE' },
    { key: 'physics', no: 8, name: '物理', graph: 'physics', prefix: 'PH' },
    { key: 'chemistry', no: 9, name: '化学', graph: 'chemistry', prefix: 'CH' },
    { key: 'biology', no: 10, name: '生物学', graph: 'biology', prefix: 'BI' },
    { key: 'it', no: 11, name: '信息技术', graph: 'it', prefix: 'IT' },
    { key: 'technology', no: 12, name: '通用技术', graph: 'technology', prefix: 'GT' },
    { key: 'art', no: 13, name: '艺术', graph: 'arts', prefix: 'AR' },
    { key: 'music', no: 14, name: '音乐', graph: 'arts', prefix: 'AR' },
    { key: 'fineart', no: 15, name: '美术', graph: 'arts', prefix: 'AR' },
    { key: 'pe', no: 16, name: '体育与健康', graph: 'pe', prefix: 'PE' }
]
// the match key: width-folded, no whitespace, so a line break or a stray space never hides a verbatim quote
export const keyOf = text => String(text).normalize('NFKC').replace(/\s+/gu, '')
