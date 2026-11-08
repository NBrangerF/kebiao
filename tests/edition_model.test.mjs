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
