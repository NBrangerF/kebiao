// A small zip writer for the Word (.docx) exports. Parts are deflated with the browser's own CompressionStream where it
// knows 'deflate-raw', and stored as they are otherwise; Word, WPS and iOS read both. No zip64: the parts are small.

const CRC_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
        let c = n
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        table[n] = c >>> 0
    }
    return table
})()

export function crc32(bytes) {
    let crc = 0xffffffff
    for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
}

async function deflateRaw(bytes) {
    try {
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
        return new Uint8Array(await new Response(stream).arrayBuffer())
    } catch {
        return null // no CompressionStream, or no 'deflate-raw' (Safari before 16.4): store instead
    }
}

// files: [{ name, data }] with data a string (written as UTF-8) or bytes; returns the zip as bytes
export async function zip(files) {
    const encoder = new TextEncoder()
    const now = new Date()
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
    const date = (Math.max(now.getFullYear() - 1980, 0) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
    const locals = []
    const centrals = []
    let offset = 0
    for (const file of files) {
        const name = encoder.encode(file.name)
        const raw = typeof file.data === 'string' ? encoder.encode(file.data) : file.data
        const packed = await deflateRaw(raw)
        const deflated = packed && packed.length < raw.length
        const body = deflated ? packed : raw
        const crc = crc32(raw)
        const local = new DataView(new ArrayBuffer(30))
        local.setUint32(0, 0x04034b50, true)
        local.setUint16(4, 20, true)
        local.setUint16(6, 0x0800, true) // names are UTF-8
        local.setUint16(8, deflated ? 8 : 0, true)
        local.setUint16(10, time, true)
        local.setUint16(12, date, true)
        local.setUint32(14, crc, true)
        local.setUint32(18, body.length, true)
        local.setUint32(22, raw.length, true)
        local.setUint16(26, name.length, true)
        locals.push(new Uint8Array(local.buffer), name, body)
        const central = new DataView(new ArrayBuffer(46))
        central.setUint32(0, 0x02014b50, true)
        central.setUint16(4, 20, true)
        central.setUint16(6, 20, true)
        central.setUint16(8, 0x0800, true)
        central.setUint16(10, deflated ? 8 : 0, true)
        central.setUint16(12, time, true)
        central.setUint16(14, date, true)
        central.setUint32(16, crc, true)
        central.setUint32(20, body.length, true)
        central.setUint32(24, raw.length, true)
        central.setUint16(28, name.length, true)
        central.setUint32(42, offset, true)
        centrals.push(new Uint8Array(central.buffer), name)
        offset += 30 + name.length + body.length
    }
    const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
    const end = new DataView(new ArrayBuffer(22))
    end.setUint32(0, 0x06054b50, true)
    end.setUint16(8, files.length, true)
    end.setUint16(10, files.length, true)
    end.setUint32(12, centralSize, true)
    end.setUint32(16, offset, true)
    const parts = [...locals, ...centrals, new Uint8Array(end.buffer)]
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}
