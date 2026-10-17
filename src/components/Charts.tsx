import { useLayoutEffect, useMemo, useRef, useState } from "react"

import { clockFor, quarters, tickClock, timeTicks } from "@/lib/format"

/**
 * Charts are drawn by hand as SVG rather than pulled from a charting library.
 * The theme is one static bundle the hub serves from disk, and a charting
 * dependency would outweigh everything else in it.
 *
 * The house style is the opposite of the usual dashboard chart: one hairline per
 * gridline in the faintest grey on the page, no plot background at all (the page
 * is already white), and a 1.5px line with no glow. Gridlines are horizontal
 * only, and there are four of them: the point of a status chart is the shape of
 * the line, and every decoration on top of it is something to read past.
 */

export type Point = { ts: number; v: number | null }

export type Series = {
  id: string
  name: string
  color: string
  /** Aligned with the chart's `rows`. */
  values: (number | null)[]
  /** Dashed, for a series the operator should read as secondary. */
  dashed?: boolean
}

/** Element width, tracked so the plot is drawn in real pixels and text stays crisp. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    setWidth(node.clientWidth)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}

/**
 * Contiguous runs of non-null samples, so a gap breaks the line rather than
 * spanning it.
 *
 * More samples than pixels are grouped by pixel column and drawn as one vertical
 * span per column, from the smallest sample in it to the largest. Drawing them
 * one by one instead is what produced the dense sawtooth this chart used to show:
 * a probe at the seven-day tier reports 721 times across about 900px, so the
 * samples land 1.2px apart and the line reverses direction at almost every
 * pixel -- a zigzag that is entirely an artefact of the drawing, carrying no
 * information about the link.
 *
 * The span keeps the extremes exactly, which is what a latency chart is read for:
 * a spike is still a spike reaching the same height, it is only the sub-pixel
 * chatter between samples that goes away. A column with a single sample draws as
 * a dot (a zero-length span) rather than vanishing.
 */
function segments(
  values: (number | null)[],
  x: (i: number) => number,
  y: (v: number, i: number) => number,
  budget: number,
) {
  const paths: string[] = []

  // One sample per pixel or fewer: join them in order, nothing to collapse.
  if (values.length <= budget) {
    let current: string[] = []
    values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        if (current.length > 1) paths.push(current.join(" "))
        current = []
        return
      }
      current.push(`${current.length ? "L" : "M"}${x(i).toFixed(2)} ${y(v, i).toFixed(2)}`)
    })
    if (current.length > 1) paths.push(current.join(" "))
    return paths
  }

  // Denser than the plot is wide: one span per pixel column.
  const columns = Math.max(1, Math.floor(budget))
  const per = values.length / columns
  let current: string[] = []

  for (let c = 0; c < columns; c++) {
    const from = Math.floor(c * per)
    const to = Math.min(values.length, Math.max(from + 1, Math.floor((c + 1) * per)))
    let low = Infinity
    let high = -Infinity
    let lowAt = from
    let highAt = from
    for (let i = from; i < to; i++) {
      const v = values[i]
      if (v === null || !Number.isFinite(v)) continue
      if (v < low) {
        low = v
        lowAt = i
      }
      if (v > high) {
        high = v
        highAt = i
      }
    }

    if (low === Infinity) {
      // A column with no reading: break the line here, exactly as a single null
      // sample does.
      if (current.length > 1) paths.push(current.join(" "))
      current = []
      continue
    }

    // Enter the column at the earlier extreme and leave at the later one, so the
    // span joins its neighbours at the height the readings actually reached
    // there rather than jumping.
    const first = lowAt <= highAt ? low : high
    const firstAt = lowAt <= highAt ? lowAt : highAt
    const last = lowAt <= highAt ? high : low
    const lastAt = lowAt <= highAt ? highAt : lowAt

    current.push(`${current.length ? "L" : "M"}${x(firstAt).toFixed(2)} ${y(first, firstAt).toFixed(2)}`)
    if (low !== high) {
      current.push(`L${x(lastAt).toFixed(2)} ${y(last, lastAt).toFixed(2)}`)
    }
  }

  if (current.length > 1) paths.push(current.join(" "))
  return paths
}


/** The isolated samples a broken line would otherwise not show at all. */
function dots(values: (number | null)[], x: (i: number) => number, y: (v: number, i: number) => number) {
  const out: { cx: number; cy: number }[] = []
  // A dot says "there is a sample here", which only needs saying when the sample
  // has no neighbour to be joined to. Past a hundred points the line carries the
  // shape and one circle per bucket is noise -- and on a probe series, which
  // reports on its own schedule and is therefore almost entirely isolated points,
  // it was a circle for every sample.
  if (values.length > 100) return out
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return
    const before = i > 0 ? values[i - 1] : null
    const after = i < values.length - 1 ? values[i + 1] : null
    if (before === null && after === null) out.push({ cx: x(i), cy: y(v, i) })
  })
  return out
}

type Props = {
  /** Time stamps of every bucket, ascending; every series' values align with these. */
  rows: { ts: number }[]
  series: Series[]
  height?: number
  /** The axis top. Ignored when `domain` is given. */
  top?: number
  /** A fixed axis, used by the logarithmic rate chart. */
  domain?: [number, number]
  ticks?: number[]
  format: (n: number) => string
  /** Marks the chart as a percentage of a known total. */
  unit?: string
  /** Window width in hours, which decides the tick format. */
  hours: number
  /** Hidden by the legend. */
  hidden?: Set<string>
  onToggle?: (id: string) => void
  /** Latency charts carry a per-probe loss figure in the legend. */
  note?: (id: string) => string | null
  /**
   * Drop the legend below the plot. Used where the same information sits above
   * the chart in buttons, so a second copy under the axes is just noise -- and
   * the one under the axes cannot be seen from a tall chart without scrolling.
   */
  noLegend?: boolean
}

export function Chart({
  rows,
  series,
  height = 150,
  top,
  domain,
  ticks: fixedTicks,
  format,
  unit,
  hours,
  hidden,
  onToggle,
  note,
  noLegend = false,
}: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [at, setAt] = useState<number | null>(null)

  const shown = series.filter((s) => !hidden?.has(s.id))
  // Room on the left for a value like "1.5 GB"; nothing on the right, because a
  // line that runs off the edge of the plot is read as continuing, and a pad
  // there only shortens the window.
  const pad = { l: 46, r: 8, t: 10, b: 20 }
  const inner = Math.max(10, width - pad.l - pad.r)
  const plot = height - pad.t - pad.b

  const lo = domain ? domain[0] : 0
  const hi = domain ? domain[1] : (top ?? 1)
  const log = Boolean(domain)

  const y = useMemo(() => {
    if (log) {
      const l0 = Math.log(lo)
      const l1 = Math.log(hi)
      return (v: number) => pad.t + plot - ((Math.log(Math.max(v, lo)) - l0) / (l1 - l0)) * plot
    }
    return (v: number) => pad.t + plot - ((v - lo) / Math.max(hi - lo, 1e-9)) * plot
  }, [log, lo, hi, pad.t, plot])

  const x = useMemo(() => {
    const first = rows[0]?.ts ?? 0
    const last = rows[rows.length - 1]?.ts ?? first + 1
    const span = Math.max(last - first, 1)
    // A single bucket has no span to divide by; it is drawn at the left edge.
    if (rows.length < 2) return () => pad.l + inner / 2
    return (i: number) => pad.l + ((rows[i].ts - first) / span) * inner
  }, [rows, pad.l, inner])

  const yTicks = useMemo(() => {
    if (fixedTicks?.length) return fixedTicks
    return quarters(hi).filter((v) => v >= lo)
  }, [fixedTicks, hi, lo])

  const xTicks = useMemo(() => {
    if (rows.length < 2) return []
    return timeTicks(rows[0].ts, rows[rows.length - 1].ts, Math.max(2, Math.min(7, Math.floor(inner / 90))))
  }, [rows, inner])

  const label = useMemo(() => {
    if (!xTicks.length) return () => ""
    return tickClock(xTicks, hours)
  }, [xTicks, hours])

  const gridY = yTicks.map(y)
  const picked = at !== null && at >= 0 && at < rows.length ? at : null
  const base = pad.t + plot

  const pick = (event: React.PointerEvent<SVGSVGElement>) => {
    if (rows.length < 2) return
    const box = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - box.left
    const ratio = (px - pad.l) / inner
    const index = Math.round(ratio * (rows.length - 1))
    setAt(Math.max(0, Math.min(rows.length - 1, index)))
  }

  const clock = clockFor(hours)

  return (
    <div className="chart-holder">
      <div ref={ref} style={{ width: "100%" }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" onPointerMove={pick} onPointerLeave={() => setAt(null)} style={{ touchAction: "none" }}>
            {gridY.map((gy, i) => (
              <g key={i}>
                <line className="grid-line" x1={pad.l} x2={pad.l + inner} y1={gy} y2={gy} />
                <text className="tick-text" x={pad.l - 8} y={gy + 3.5} textAnchor="end">
                  {format(yTicks[i])}
                </text>
              </g>
            ))}

            {xTicks.map((t, i) => {
              const first = rows[0].ts
              const last = rows[rows.length - 1].ts
              const px = pad.l + ((t - first) / Math.max(last - first, 1)) * inner
              return (
                <text key={i} className="tick-text" x={px} y={height - 5} textAnchor="middle">
                  {label(t)}
                </text>
              )
            })}

            {/* The baseline, and only the baseline: with horizontal gridlines
                already drawn, a vertical rule under every tick is a second grid
                saying the same thing. */}
            <line className="axis-line" x1={pad.l} x2={pad.l + inner} y1={base} y2={base} />

            {shown.map((s) => (
              <g key={s.id}>
                {segments(s.values, x, y, inner).map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={s.dashed ? "4 4" : undefined}
                  />
                ))}
                {dots(s.values, x, y).map((d, i) => (
                  <circle key={i} cx={d.cx} cy={d.cy} r="2" fill={s.color} />
                ))}
              </g>
            ))}

            {picked !== null && (
              <g>
                <line className="crosshair" x1={x(picked)} x2={x(picked)} y1={pad.t} y2={base} />
                {shown.map((s) => {
                  const v = s.values[picked]
                  return v === null || !Number.isFinite(v) ? null : (
                    <circle key={s.id} cx={x(picked)} cy={y(v)} r="3" fill="#fff" stroke={s.color} strokeWidth="1.5" />
                  )
                })}
              </g>
            )}
          </svg>
        )}
      </div>

      {/* The crosshair readout sits outside the SVG so it never covers the plot. */}
      <div className="readout">
        {picked !== null ? (
          <>
            <span className="stamp">{clock(rows[picked].ts)}</span>
            {shown.map((s) => {
              const v = s.values[picked]
              return (
                <span key={s.id}>
                  <i className="dot" style={{ background: s.color }} />
                  {s.name} {v === null ? "—" : `${format(v)}${unit ?? ""}`}
                </span>
              )
            })}
          </>
        ) : (
          <span className="quiet">在图上移动指针读取数值</span>
        )}
      </div>

      {!noLegend && series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <button key={s.id} type="button" data-off={hidden?.has(s.id) ? "true" : undefined} onClick={() => onToggle?.(s.id)}>
              <i className="dot" style={{ background: s.color }} />
              {s.name}
              {note?.(s.id) ? <span className="quiet">{note(s.id)}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
