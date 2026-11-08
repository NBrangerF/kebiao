// Writes the lesson-plan exports as real Word files (.docx: WordprocessingML in a zip), so they open in Word and WPS
// with A4 pages and school margins, and preview on iPhone and in WeChat, which show an HTML file renamed .doc as a
// blank page. Loaded only when a teacher downloads, so the page itself stays small.
//
// Blocks (built in lessonPlanExport.js):
//   { type: 'title', text }  { type: 'h', text }  { type: 'meta' | 'p' | 'indent' | 'note' | 'hint' | 'foot' | 'body', runs }
//   { type: 'list', items: [runs], ordered?, bullet? }
//   { type: 'table', cols: [fraction | null], head?: [runs], rows: [[runs | { paras: [runs] }]], minHeight? }
//     (the header row repeats on each page)
//   { type: 'box', lines?: [runs], minHeight? }   a bordered box: the 板书, or room to write
// runs: a string, { text, b?, dim?, small? }, or an array of them; '\n' inside a text is a line break.
import { zip } from './zip.js'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const A4 = { width: 11906, height: 16838 }
// Word's own default for Chinese documents: 2.54 cm top and bottom, 3.17 cm left and right
export const PAGE = { margins: [1440, 1800, 1440, 1800], size: 24 }

const esc = value => String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/gu, '')
    .replace(/[&<>"]/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]))

// Line breaks are <w:br/>. 课标 codes keep plain hyphens: Apple's preview (iPhone, Mac) drops <w:noBreakHyphen/>.
const textXml = text => String(text).split('\n').map(line => (line ? `<w:t xml:space="preserve">${esc(line)}</w:t>` : '')).join('<w:br/>')

const segments = runs => (Array.isArray(runs) ? runs.flatMap(segments) : runs == null || runs === false || runs === '' ? [] : [typeof runs === 'object' ? runs : { text: String(runs) }])

const runsXml = runs => segments(runs).map(seg => {
    const props = `${seg.b ? '<w:b/><w:bCs/>' : ''}${seg.dim ? '<w:color w:val="666666"/>' : ''}${seg.small ? '<w:sz w:val="18"/><w:szCs w:val="18"/>' : ''}`
    return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${textXml(seg.text ?? '')}</w:r>`
}).join('')

const STYLE = { title: 'Title', h: 'Heading1', meta: 'Meta', p: '', note: 'Note', hint: 'Hint', foot: 'Foot', body: 'Body', indent: 'Indent' }
const para = (style, runs, extra = '') => `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : ''}${runsXml(runs)}</w:p>`

const BORDER = side => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`
// Word refuses a cell without a paragraph, so an empty cell still gets one
const cellParas = cell => {
    const paras = cell && cell.paras ? cell.paras : [cell]
    return paras.length ? paras : ['']
}
const tableXml = (widths, rows, { head = false, minHeight = 0 } = {}) => {
    const total = widths.reduce((sum, width) => sum + width, 0)
    const row = (cells, isHead) => `<w:tr>${isHead || minHeight ? `<w:trPr>${isHead ? '<w:tblHeader/>' : ''}${!isHead && minHeight ? `<w:trHeight w:val="${minHeight}" w:hRule="atLeast"/>` : ''}</w:trPr>` : ''}${cells.map((cell, index) => `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/>${isHead ? '<w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>' : ''}</w:tcPr>${cellParas(cell).map(item => para('Cell', isHead ? segments(item).map(seg => ({ ...seg, b: true })) : item)).join('')}</w:tc>`).join('')}</w:tr>`
    return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(BORDER).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="85" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows.map((cells, index) => row(cells, head && index === 0)).join('')}</w:tbl>`
}

// Column widths in twips from fractions of the text width; columns without one share what is left
const columnWidths = (cols, width) => {
    const fixed = cols.reduce((sum, col) => sum + (col || 0), 0)
    const free = cols.filter(col => !col).length
    return cols.map(col => Math.floor(width * (col || (free ? Math.max(1 - fixed, 0) / free : 0))))
}

function blockXml(block, width) {
    switch (block.type) {
        case 'title': return para('Title', block.text)
        case 'h': return para('Heading1', block.text)
        case 'list': return block.items.map((item, index) => para('Item', [block.ordered ? `${index + 1}. ` : `${block.bullet ?? '·'} `, item])).join('')
        case 'table': return `${tableXml(columnWidths(block.cols, width), block.head ? [block.head, ...block.rows] : block.rows, { head: Boolean(block.head), minHeight: block.minHeight })}${para('Gap', '')}`
        case 'box': return `${tableXml([width], [[{ paras: block.lines?.length ? block.lines : [''] }]], { minHeight: block.minHeight || 0 })}${para('Gap', '')}`
        default: return para(STYLE[block.type] ?? '', block.runs)
    }
}

// Normal repeats the default font and size: Apple's preview ignores docDefaults
const stylesXml = size => {
    const cell = Math.max(size - 3, 18)
    const style = (id, name, ppr, rpr, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${extra}<w:qFormat/>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}</w:style>`
    const hei = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="黑体" w:cs="Times New Roman"/>'
    const sz = half => `<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/>${sz(size)}<w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${size > 22 ? 360 : 300}" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/>${sz(size)}</w:rPr></w:style>
${style('Title', 'Title', '<w:spacing w:after="120"/><w:jc w:val="center"/>', `${hei}<w:b/>${sz(size + 12)}`, '<w:next w:val="Meta"/>')}
${style('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="200" w:after="60"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/>', `${hei}${sz(size + 4)}`, '<w:next w:val="Normal"/>')}
${style('Meta', 'Meta', '<w:spacing w:after="60"/><w:jc w:val="center"/>', `<w:color w:val="444444"/>${sz(size - 3)}`)}
${style('Note', 'Note', '', `<w:color w:val="666666"/>${sz(Math.max(size - 5, 18))}`)}
${style('Hint', 'Hint', '<w:keepNext/>', `<w:color w:val="666666"/>${sz(Math.max(size - 5, 18))}`)}
${style('Foot', 'Foot', '<w:spacing w:before="240"/>', `<w:color w:val="666666"/>${sz(18)}`)}
${style('Body', 'Body', '<w:spacing w:after="60"/><w:ind w:firstLineChars="200" w:firstLine="480"/>', '')}
${style('Item', 'List Item', '<w:ind w:left="360" w:hanging="360"/>', '')}
${style('Indent', 'Indent', '<w:ind w:left="480"/>', '')}
${style('Cell', 'Table Text', '<w:spacing w:line="260" w:lineRule="auto"/><w:jc w:val="left"/>', sz(cell))}
${style('Gap', 'Gap', '<w:spacing w:line="120" w:lineRule="exact"/>', sz(8))}
</w:styles>`
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`
// compatibilityMode 15: Word opens it as a current document, not in 兼容模式
const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="420"/><w:characterSpacingControl w:val="compressPunctuation"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`

export function documentXml(blocks, page = PAGE) {
    const [top, right, bottom, left] = page.margins
    const width = A4.width - left - right
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${blocks.filter(Boolean).map(block => blockXml(block, width)).join('')}<w:sectPr><w:pgSz w:w="${A4.width}" w:h="${A4.height}"/><w:pgMar w:top="${top}" w:right="${right}" w:bottom="${bottom}" w:left="${left}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`
}

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export async function docxBlob(blocks, { title = '', page = PAGE } = {}) {
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>kebiao.org</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/u, 'Z')}</dcterms:created></cp:coreProperties>`
    const bytes = await zip([
        { name: '[Content_Types].xml', data: CONTENT_TYPES },
        { name: '_rels/.rels', data: ROOT_RELS },
        { name: 'word/document.xml', data: documentXml(blocks, page) },
        { name: 'word/styles.xml', data: stylesXml(page.size || PAGE.size) },
        { name: 'word/settings.xml', data: SETTINGS },
        { name: 'word/_rels/document.xml.rels', data: DOC_RELS },
        { name: 'docProps/core.xml', data: core }
    ])
    return new Blob([bytes], { type: DOCX_TYPE })
}
