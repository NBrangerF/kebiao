// Two editions of one volume (人教版 and 北师大版 数学7上): the 对应表 measures 「本年级」 by the book's own edition,
// and the header names the publisher briefly.
import assert from 'node:assert/strict'
import test from 'node:test'
import { bookCoverage } from '../src/features/textbooks/alignmentModel.js'
import { publisherOf } from '../src/features/mybook/myBook.js'

const subject = {
    standards: [{
        code: 'MA-S4-SG-01', grades: [7, 8, 9], level1: '图形与几何', indicators: [
            { code: 'MA-S4-SG-01.1', text: '三角形', grades: [8] },
            { code: 'MA-S4-SG-01.2', text: '立体图形', grades: [7] }
        ]
    }]
}
const units = [{ name: '第四章 三角形', lessons: [{ rows: [['MA-S4-SG-01.1', 'T', '认识三角形', 'book', 80]] }] }]

test('a second edition counts the 要点 it teaches in its own grade', () => {
    const book = { title: '数学7年级下册', grade: 7 }
    // placed in 八年级 from 人教版's chapters: not 本年级 for a 七年级 book
    assert.equal(bookCoverage(units, subject, book).taught, 0)
    // 北师大版 teaches it in 七年级下册
    const own = bookCoverage(units, subject, book, { 'MA-S4-SG-01.1': [7] })
    assert.equal(own.taught, 1)
    assert.deepEqual(own.groups[0].points.map(point => point.code), ['MA-S4-SG-01.1', 'MA-S4-SG-01.2'])
})

test('publisherOf keeps the publisher only', () => {
    assert.equal(publisherOf('人教版 PEP（三年级起点）'), '人教')
    assert.equal(publisherOf('外研社版（孙有中）'), '外研社')
    assert.equal(publisherOf('北师大版'), '北师大')
    assert.equal(publisherOf('人音版（简谱，赵季平、杜永寿）'), '人音')
})

// 课堂诊断: a second edition of a subject (北师大版 数学, 外研社版 英语) gets its own files, ids and book keys
import { bookKeyOf, bookOf, subjectBySlug } from '../src/features/checks/subjects.js'
import { bookGroups, bookInGroup } from '../src/features/checks/checksData.js'

test('a second edition of a check bank has its own file, ids and book key', () => {
    const book = bookOf({ subject: '数学', grade: 5, term: '上', edition: '北师大版' })
    assert.equal(book.key, '北师大5上')
    assert.equal(book.stem, 'bsd-5a')
    assert.equal(book.label, '五年级上册')
    // the main edition keeps its old keys, so saved links still open
    assert.equal(bookOf({ subject: '数学', grade: 5, term: '上', edition: '人教版' }).key, '5上')
    assert.equal(bookOf({ subject: '英语', grade: 7, term: '下', edition: '外研社版（孙有中）' }).stem, 'wy-7b')
})

test('a library volume finds its own edition in the bank', () => {
    const math = subjectBySlug('math')
    assert.equal(bookKeyOf(math, { grade: 5, volume: '上册', edition: '北师大版' }), '北师大5上')
    assert.equal(bookKeyOf(math, { grade: 5, volume: '上册', edition: '人教版' }), '5上')
    // an edition the bank doesn't cover has no key (its page shows no checks link)
    assert.equal(bookKeyOf(math, { grade: 5, volume: '上册', edition: '苏教版' }), '')
    assert.equal(bookKeyOf(subjectBySlug('labor'), { grade: 4 }), '3-4')
})

test('switching publisher keeps the volume when it has questions', () => {
    const bank = { books: [
        { key: '5上', grade: 5, term: '上', edition: '人教版', count: 20 },
        { key: '北师大5上', grade: 5, term: '上', edition: '北师大版', count: 30 },
        { key: '北师大6上', grade: 6, term: '上', edition: '北师大版', count: 0 }
    ] }
    const groups = bookGroups(bank)
    assert.deepEqual(groups.map(group => group.name), ['人教版', '北师大版'])
    assert.equal(bookInGroup(groups[1], bank.books[0]), '北师大5上')
})
