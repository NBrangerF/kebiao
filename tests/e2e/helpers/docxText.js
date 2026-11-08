import { readFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

// The text of a downloaded Word file (.docx): word/document.xml from the zip, one line per paragraph
export async function docxText(path) {
    const bytes = await readFile(path)
    let end = bytes.length - 22
    while (bytes.readUInt32LE(end) !== 0x06054b50) end -= 1
    let at = bytes.readUInt32LE(end + 16)
    for (let i = 0; i < bytes.readUInt16LE(end + 10); i += 1) {
        const nameLength = bytes.readUInt16LE(at + 28)
        if (bytes.toString('utf8', at + 46, at + 46 + nameLength) === 'word/document.xml') {
            const offset = bytes.readUInt32LE(at + 42)
            const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28)
            const body = bytes.subarray(start, start + bytes.readUInt32LE(at + 20))
            const xml = (bytes.readUInt16LE(at + 10) === 8 ? inflateRawSync(body) : body).toString('utf8')
            return xml.replace(/<w:br\/>/gu, '\n').replace(/<\/w:p>/gu, '\n').replace(/<[^>]+>/gu, '')
                .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&amp;/gu, '&')
        }
        at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32)
    }
    throw new Error(`no word/document.xml in ${path}`)
}
