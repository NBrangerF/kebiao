import { useLayoutEffect, useRef, useState } from 'react'
import { columnLabel, isJuniorKey, isSeniorKey } from './graphData'
import styles from './KnowledgeGraph.module.css'

/**
 * 全景: each row a thread (同一主题 across the grades), each column a grade, each dot a 要点 — gold when a lesson
 * was found that mainly teaches it. Phones get the same rows running down the page.
 * A station (one standard in one column) is the keyboard stop; a dot inside it opens that 要点.
 * 高中 dots are blue: their columns are the 课标's 必修 / 选择性必修 / 选修, and no textbook has been aligned to them yet.
 */
export default function GraphOverview({ graph, wide, mine, onPick }) {
    return wide ? <Grid graph={graph} mine={mine} onPick={onPick} /> : <Lanes graph={graph} mine={mine} onPick={onPick} />
}

function pointsIn(graph, std, column) {
    return (graph.standards[std]?.points || []).filter(code => (graph.points[code]?.col ?? graph.external[code]?.col) === column)
}

function Station({ graph, std, column, onPick, root = false }) {
    const codes = pointsIn(graph, std, column)
    if (!codes.length) return null
    const info = graph.standards[std]
    const pick = event => {
        const code = event.target.closest('[data-code]')?.dataset.code || codes[0]
        onPick(code, root ? 'science' : graph.slug)
    }
    return (
        <button
            type="button"
            className={`${styles.station} ${root ? styles.stationRoot : ''}`}
            data-std={std}
            onClick={pick}
            aria-label={`${root ? '小学科学 · ' : ''}${info.title}（${columnLabel(graph, column)}）：${codes.length} 个要点`}
        >
            <span className={styles.stationName}>{info.title}</span>
            <span className={styles.dots} aria-hidden="true">
                {codes.map(code => {
                    const taught = root ? true : graph.points[code]?.n?.[0] > 0
                    return <span key={code} data-code={code} className={`${styles.dot} ${isSeniorKey(column) ? styles.dotSenior : taught ? '' : styles.dotNone}`} />
                })}
            </span>
        </button>
    )
}

// a standard can span columns (代数式: 七, 八 and 七至九年级共同); count its 要点 once
function laneCount(graph, lane) {
    return [...new Set(Object.values(lane.cells).flat())].reduce((sum, std) => sum + graph.standards[std].points.length, 0)
}

function Grid({ graph, mine, onPick }) {
    const columns = graph.columns
    const juniorKeys = columns.filter(column => /^\d$/u.test(column.key)).map(column => column.key)
    const figRef = useRef(null)
    const svgRef = useRef(null)
    const bandRef = useRef(null)
    const seniorRef = useRef(null)
    const [tip, setTip] = useState(null)
    const [openCells, setOpenCells] = useState(() => new Set())
    const toggleCell = key => setOpenCells(current => {
        const next = new Set(current)
        if (!next.delete(key)) next.add(key)
        return next
    })

    // the thread lines: through the first station of each column of a row, a branch from its parent row
    useLayoutEffect(() => {
        const fig = figRef.current
        const svg = svgRef.current
        if (!fig || !svg) return undefined
        const draw = () => {
            const box = fig.getBoundingClientRect()
            svg.setAttribute('width', box.width)
            svg.setAttribute('height', box.height)
            svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`)
            const centre = el => {
                const r = el.getBoundingClientRect()
                return [r.left - box.left + r.width / 2, r.top - box.top + r.height / 2]
            }
            let paths = ''
            for (const lane of graph.lanes) {
                const stops = columns.map(column => fig.querySelector(`[data-lane="${lane.id}"][data-col="${column.key}"] [data-std]`)).filter(Boolean)
                const points = stops.map(centre)
                if (lane.from && points.length) {
                    const firstKey = columns.findIndex(column => fig.querySelector(`[data-lane="${lane.id}"][data-col="${column.key}"] [data-std]`))
                    // the branch starts from the parent's last primary station (函数 grows out of 数量关系 in 5–6)
                    const parentStops = columns.slice(0, firstKey).filter(column => !isJuniorKey(column.key) && !column.senior).map(column => fig.querySelector(`[data-lane="${lane.from}"][data-col="${column.key}"] [data-std]`)).filter(Boolean)
                    const from = parentStops.at(-1)
                    if (from) {
                        const [x1, y1] = centre(from)
                        const [x2, y2] = points[0]
                        const mid = (x1 + x2) / 2
                        paths += `<path class="${styles.fork}" d="M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}"/>`
                    }
                }
                if (points.length > 1) paths += `<path d="M${points.map(point => point.join(' ')).join(' L')}"/>`
                // a column can hold several stations of the row: tie them to the row's line, so none looks stranded
                for (const column of columns) {
                    const inCell = [...fig.querySelectorAll(`[data-lane="${lane.id}"][data-col="${column.key}"] [data-std]`)]
                    if (inCell.length > 1) {
                        const [x, top] = centre(inCell[0])
                        const bottom = centre(inCell.at(-1))[1]
                        paths += `<path class="${styles.spine}" d="M${x} ${top} L${x} ${bottom}"/>`
                    }
                }
            }
            svg.innerHTML = paths
            const head = mine ? fig.querySelector(`[data-head="${mine}"]`) : null
            if (bandRef.current) {
                bandRef.current.hidden = !head
                if (head) {
                    bandRef.current.style.left = `${head.offsetLeft}px`
                    bandRef.current.style.width = `${head.offsetWidth}px`
                }
            }
            // the 高中 columns stand on their own ground, so the step out of 义务教育 is visible at a glance
            const seniorHeads = columns.filter(column => column.senior).map(column => fig.querySelector(`[data-head="${column.key}"]`)).filter(Boolean)
            if (seniorRef.current) {
                seniorRef.current.hidden = !seniorHeads.length || seniorHeads.length === columns.length
                if (seniorHeads.length) {
                    seniorRef.current.style.left = `${seniorHeads[0].offsetLeft}px`
                    seniorRef.current.style.width = `${seniorHeads.at(-1).offsetLeft + seniorHeads.at(-1).offsetWidth - seniorHeads[0].offsetLeft}px`
                }
            }
        }
        draw()
        const observer = new ResizeObserver(draw)
        observer.observe(fig)
        return () => observer.disconnect()
    }, [graph, columns, mine, openCells])

    const showTip = event => {
        const dot = event.target.closest('[data-code]')
        if (!dot || !figRef.current) { setTip(null); return }
        const code = dot.dataset.code
        const own = graph.points[code]
        const ext = graph.external[code]
        const fig = figRef.current.getBoundingClientRect()
        const r = dot.getBoundingClientRect()
        const left = r.left - fig.left + 18 + 300 > fig.width ? r.left - fig.left - 312 : r.left - fig.left + 18
        setTip({ code, own, ext, left: Math.max(0, left), top: r.top - fig.top - 6 })
    }

    const template = `minmax(9.5rem, 13rem) repeat(${columns.length}, minmax(0, 1fr))`
    const firstJunior = columns.findIndex(column => /^\d$/u.test(column.key))
    let group = null
    const rows = []
    for (const lane of graph.lanes) {
        if (lane.group && lane.group !== group) {
            group = lane.group
            rows.push(<div key={`g-${group}`} className={styles.group} role="presentation">{group}</div>)
        }
        const parent = lane.from ? graph.lanes.find(item => item.id === lane.from) : null
        rows.push(
            <div key={`n-${lane.id}`} className={styles.laneName} style={{ gridColumn: 1 }}>
                {lane.name}
                <small>{laneCount(graph, lane)} 个要点{parent ? ` · 从「${parent.name.split(' → ')[0]}」分出` : ''}</small>
                {lane.requirements?.length ? (
                    <details className={styles.requirements}>
                        <summary>学业要求</summary>
                        {lane.requirements.map(item => <p key={item.text.slice(0, 24)}>{item.text}<small>（课标第 {item.pages.join('、')} 页）</small></p>)}
                    </details>
                ) : null}
            </div>
        )
        for (const column of columns) {
            const stds = [...(lane.cells[column.key] || []).map(std => [std, false]), ...(lane.roots?.[column.key] || []).map(std => [std, true])]
            const cellKey = `${lane.id}-${column.key}`
            // 高中选修 can hold a dozen parallel modules in one row: the first few show, the rest on request
            const folds = column.senior && stds.length > MAX_STATIONS
            const open = openCells.has(cellKey)
            rows.push(
                <div key={cellKey} className={styles.cell} data-lane={lane.id} data-col={column.key}>
                    {(folds && !open ? stds.slice(0, MAX_STATIONS) : stds).map(([std, root]) => <Station key={std} graph={graph} std={std} column={column.key} root={root} onPick={onPick} />)}
                    {folds ? <button type="button" className={styles.moreStations} aria-expanded={open} onClick={() => toggleCell(cellKey)}>{open ? '收起' : `另外 ${stds.length - MAX_STATIONS} 个 ▾`}</button> : null}
                </div>
            )
        }
        if (lane.cells.shared?.length && firstJunior >= 0) {
            rows.push(
                <div key={`${lane.id}-shared`} className={`${styles.cell} ${styles.shared}`} style={{ gridColumn: `${firstJunior + 2} / span ${juniorKeys.length}` }}>
                    <span className={styles.sharedLabel}>七至九年级共同</span>
                    {lane.cells.shared.map(std => <Station key={std} graph={graph} std={std} column="shared" onPick={onPick} />)}
                </div>
            )
        }
    }

    return (
        <div className={styles.overview} ref={figRef} onMouseOver={showTip} onMouseLeave={() => setTip(null)}>
            <svg className={styles.wires} ref={svgRef} aria-hidden="true" />
            <div className={styles.grid} style={{ gridTemplateColumns: template }}>
                <div ref={seniorRef} className={styles.seniorBand} hidden />
                <div ref={bandRef} className={styles.band} hidden />
                <div className={`${styles.head} ${styles.headLane}`}>线索</div>
                {columns.map(column => (
                    <div key={column.key} data-head={column.key} className={`${styles.head} ${column.root ? styles.headRoot : ''} ${column.senior ? styles.headSenior : ''} ${column.key === mine ? styles.headMine : ''}`}>
                        {column.label}
                        {column.root ? <small>{column.root}</small> : column.key === mine ? <small>你的书</small> : null}
                    </div>
                ))}
                {rows}
            </div>
            {tip ? (
                <div className={styles.tip} style={{ left: tip.left, top: tip.top }}>
                    <div className={styles.tipCode}>{tip.code} · {tip.own ? columnLabel(graph, tip.own.col) : `小学科学 · ${tip.ext?.colLabel || ''}`}</div>
                    <div className={styles.tipText}>{clipText(tip.own?.t || tip.ext?.t || '', 72)}</div>
                    <div className={styles.tipLessons}>
                        {tip.own && isSeniorKey(tip.own.col) ? '高中教材的逐课对应还没有做' : tip.own ? (tip.own.tags?.length ? `教材：${tip.own.tags.join('；')}${tip.own.n[0] > tip.own.tags.length ? ` 等 ${tip.own.n[0]} 课` : ''}` : '教材里还没有找到主要在教的课') : '在科学的知识图谱里'} · 点一下看前后
                    </div>
                </div>
            ) : null}
        </div>
    )
}

const MAX_STATIONS = 5

// the phone's grade chip is narrow
const SHORT_SENIOR = { bx: '必修', xb: '选必', xx: '选修' }

function clipText(text, max) {
    const chars = [...text]
    return chars.length > max ? `${chars.slice(0, max).join('')}…` : text
}

function Lanes({ graph, mine, onPick }) {
    let group = null
    return (
        <div className={styles.lanes}>
            {graph.lanes.map(lane => {
                const head = lane.group && lane.group !== group ? (group = lane.group) : null
                const parent = lane.from ? graph.lanes.find(item => item.id === lane.from) : null
                const stops = [...graph.columns.map(column => column.key), ...(graph.columns.some(column => isJuniorKey(column.key)) ? ['shared'] : [])].map(key => [
                    key,
                    [...(lane.cells[key] || []).map(std => [std, false]), ...(lane.roots?.[key] || []).map(std => [std, true])]
                ]).filter(([, stds]) => stds.length)
                return (
                    <section key={lane.id} className={styles.lane} aria-label={lane.name}>
                        {head ? <p className={styles.laneGroup}>{head}</p> : null}
                        <h3>{lane.name}<small>{laneCount(graph, lane)} 个要点{parent ? ` · 从「${parent.name.split(' → ')[0]}」分出` : ''}</small></h3>
                        <ol className={styles.laneStops}>
                            {stops.map(([key, stds]) => {
                                const root = stds.every(([, isRoot]) => isRoot)
                                return (
                                    <li key={key}>
                                        <span className={`${styles.grade} ${key === mine ? styles.gradeMine : ''} ${root ? styles.gradeRoot : ''}`}>{key === 'shared' ? '七–九' : SHORT_SENIOR[key] || graph.columns.find(column => column.key === key)?.label.replace(' 年级', '').replace('年级', '')}</span>
                                        <span>
                                            {stds.map(([std, isRoot]) => <Station key={std} graph={graph} std={std} column={key} root={isRoot} onPick={onPick} />)}
                                        </span>
                                    </li>
                                )
                            })}
                        </ol>
                    </section>
                )
            })}
        </div>
    )
}
