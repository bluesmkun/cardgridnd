import { useEffect, useMemo, useState } from "react"
import { api, type Node } from "@/lib/api"
import { Chart, type Series } from "@/components/Charts"
import { Country, usage } from "@/components/NodeCard"
import {
  ago,
  axisBytes,
  bytes,
  bytesTop,
  cycle,
  despike,
  despikeWindow,
  money,
  movingAverage,
  osName,
  quarters,
  rate as byteRate,
  rateAxis,
  uptime,
  windows,
  withGaps,
} from "@/lib/format"

/**
 * One node, in full.
 *
 * Four charts, one per resource, rather than two charts sharing a scale. CPU is a
 * percentage and memory is a byte count: on one pair of axes either the CPU line
 * is flat along the floor or the memory line is off the top, and the reader has
 * to hold two units in their head to read either. Separate charts each get their
 * own axis and say one thing.
 *
 * The latency chart uses the same primitive with a different set of series. The
 * hub sends ping rows tagged by `task_id` and `probes` is the only place the names
 * live, so the series are built from whatever `probes` says -- a list of carrier
 * names in here would drop a probe the hub has and invent one it has not.
 */

type Row = {
  ts: number
  cpu: number
  mem_used: number
  disk_used: number
  net_rx: number
  net_tx: number
  cpu_max?: number
  net_rx_max?: number
  net_tx_max?: number
  minutes?: number
}

type PingRow = {
  task_id: number
  ts: number
  latency: number | null
  loss?: number
}

type Answer = {
  metrics?: Row[]
  ping?: PingRow[]
  probes?: Record<string, string>
  loss?: Record<string, number>
  step?: number
}

/**
 * Identical in-flight requests share one promise.
 *
 * Five charts ask for data and the window buttons re-render them all, so several
 * charts on the same window would otherwise fire the same URL within a few
 * milliseconds. The hub builds each response from its history and caps how many
 * it will build at once, answering 503 past that -- which the charts would read
 * as "no data" rather than "try again". Keyed by the whole query, dropped on
 * failure so the next attempt is a real one, and dropped once every caller has it
 * so a window revisited later is not answered from whenever it was first opened.
 */
const inflight = new Map<string, Promise<Answer>>()

function get(query: string): Promise<Answer> {
  const hit = inflight.get(query)
  if (hit) return hit
  const promise = api<Answer>(`/nodes/${query}`)
  promise.catch(() => inflight.delete(query))
  inflight.set(query, promise)
  promise.finally(() => setTimeout(() => inflight.delete(query), 0))
  return promise
}

/** The chart's window buttons, built from what the hub actually keeps. */
function useWindows(days: number | undefined) {
  return useMemo(() => windows(days ?? 7), [days])
}

/** The window the detail page opens on. */
const DEFAULT_HOURS = 6

/** The four resources, each with the axis it needs. */
function useCharts(rows: Row[], node: Node | null) {
  return useMemo(() => {
    // The smoothing window follows the bucket spacing: seven buckets is a minute
    // on the hourly tier and a week on the widest one.
    const smooth = despikeWindow(rows)

    const netPeak = Math.max(
      ...rows.map((r) => Math.max(r.net_rx_max ?? 0, r.net_tx_max ?? 0, r.net_rx, r.net_tx)),
      1,
    )

    // Usage curves are smoothed and de-spiked: a single-sample jump is almost
    // always a measurement artefact, and at 720 points it reads as a spike that
    // never happened. CPU is left alone -- a real spike there is the thing you
    // opened the page to see.
    const curve = (pick: (r: Row) => number) => despike(movingAverage(rows.map(pick), smooth))

    return {
      cpu: {
        id: "cpu",
        name: "CPU",
        color: "var(--accent)",
        values: rows.map((r) => r.cpu),
      } satisfies Series,
      memory: {
        id: "mem",
        name: "内存",
        color: "var(--accent)",
        values: curve((r) => r.mem_used),
      } satisfies Series,
      disk: {
        id: "disk",
        name: "硬盘",
        color: "var(--accent)",
        values: curve((r) => r.disk_used),
      } satisfies Series,
      netRx: {
        id: "net_rx",
        name: "下行",
        color: "var(--accent)",
        values: rows.map((r) => r.net_rx),
      } satisfies Series,
      netTx: {
        id: "net_tx",
        name: "上行",
        color: "var(--ink-faint)",
        values: rows.map((r) => r.net_tx),
      } satisfies Series,
      netAxis: rateAxis(1, netPeak),
      memTop: bytesTop(Math.max(node?.mem_total ?? 0, 1), 1024 ** 3),
      diskTop: bytesTop(Math.max(node?.disk_total ?? 0, 1), 1024 ** 3),
    }
  }, [rows, node?.mem_total, node?.disk_total])
}

/**
 * The ping rows, as one series per probe.
 *
 * Bucketed by timestamp rather than drawn per probe: each probe reports on its own
 * schedule, so without merging them onto one axis the three lines would each be
 * positioned by a different time base and could not be compared.
 */
function useProbes(
  ping: PingRow[],
  probes: Record<string, string> | undefined,
  smooth: boolean,
  clip: boolean,
) {
  return useMemo(() => {
    const names = Object.entries(probes ?? {})
    if (!names.length || !ping.length) return { series: [] as Series[], rows: [] as { ts: number }[], top: 100 }

    const times = [...new Set(ping.map((row) => row.ts))].sort((a, b) => a - b)
    const at = new Map(times.map((ts, i) => [ts, i]))
    // The window follows the bucket spacing, exactly as it does for the usage
    // curves: seven buckets is a few minutes on the hourly tier and the better
    // part of a week on the widest one.
    const window = despikeWindow(times.map((ts) => ({ ts })))

    const series = names.map(([task, name], i) => {
      // `latency: null` is a timeout. It stays null: a hole in the line is what a
      // timeout looks like, and drawing zero would put a drop to the floor that
      // never happened.
      const values: (number | null)[] = new Array(times.length).fill(null)
      for (const row of ping) {
        if (String(row.task_id) !== task) continue
        const slot = at.get(row.ts)
        if (slot === undefined) continue
        values[slot] = row.latency
      }
      // The two switches, in the order they are read: a single 3000ms sample is
      // almost always a measurement artefact at this resolution, and averaging
      // without removing it first smears it across its whole window instead of
      // taking it out. Whatever is left of the jitter is then averaged down.
      let drawn = values
      if (clip) drawn = despike(drawn, window)
      if (smooth) drawn = movingAverage(drawn, window)

      return {
        id: task,
        name,
        // A small ordered set, so the palette is by position.
        color: PROBE_COLORS[i % PROBE_COLORS.length],
        values: drawn,
      } satisfies Series
    })

    return { series, rows: times.map((ts) => ({ ts })), top: latencyTop(series) }
  }, [ping, probes, smooth, clip])
}

/**
 * An axis top for a set of latency series.
 *
 * Rounded up to a whole multiple of 50ms above the worst sample: a ping axis that
 * ends at 137ms makes every gridline an awkward number, and the readings that
 * matter here ("is this under 100?") sit on round figures.
 */
function latencyTop(series: Series[]): number {
  const samples = series
    .flatMap((s) => s.values)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b)
  if (!samples.length) return 100
  // The 95th percentile, not the maximum: a probe that times out and returns one
  // 3000ms reading would otherwise set the axis and squeeze every ordinary sample
  // into a line along the floor. A sample past the top runs off the plot, which
  // is the honest picture -- it is an outlier, and it looks like one.
  const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))]
  return Math.max(50, Math.ceil(p95 / 50) * 50)
}

const PROBE_COLORS = ["var(--accent)", "var(--warn)", "var(--ok)"]

export function NodeDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const [node, setNode] = useState<Node | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hours, setHours] = useState<number | null>(null)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [pings, setPings] = useState<Answer | null>(null)
  // Per chart, not per page: two legends sharing one set means hiding a probe
  // also hides whatever the other chart happens to call by the same id.
  const [hiddenNet, setHiddenNet] = useState<Set<string>>(new Set())
  const [hiddenPing, setHiddenPing] = useState<Set<string>>(new Set())
  // The latency chart's two drawing switches. Smoothing is on by default -- a
  // ping line at this resolution is mostly jitter, and the shape of the day is
  // what the panel is for. Peak removal is off by default: a latency spike is
  // often a real event the reader came to see, and the switch is there for when
  // it is not.
  const [smoothPing, setSmoothPing] = useState(true)
  const [clipPing, setClipPing] = useState(false)

  // The node itself comes from the list endpoint: the hub has no single-node
  // read, and the list is what the grid already holds, so this is one small
  // request rather than a second live stream.
  useEffect(() => {
    let alive = true
    api<{ nodes: Node[] }>("/nodes")
      .then((data) => {
        if (!alive) return
        const found = data.nodes.find((n) => n.id === id)
        if (found) setNode(found)
        else setError("这个节点不存在，可能已经被移除。")
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [id])

  const ranges = useWindows(node?.metrics ? 7 : undefined)
  // Six hours by default, not the widest window. The widest is what a reader
  // picks when they go looking for a trend; what they arrive for is what the
  // machine is doing today, and a week of buckets compresses this morning into
  // a few pixels. `windows()` always lists 6 hours, but fall back in case a hub
  // reports a history shorter than that.
  const preferred = ranges.some((r) => r.hours === DEFAULT_HOURS)
    ? DEFAULT_HOURS
    : (ranges[ranges.length - 1]?.hours ?? 24)
  const active = hours ?? preferred

  useEffect(() => {
    let alive = true
    get(`${id}/metrics?hours=${active}&points=720&series=metrics`)
      .then((data) => {
        if (alive) setAnswer(data)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [id, active])

  // The ping rows are a second request on the same window: a response carries
  // either the metric rows or the ping rows, not both.
  useEffect(() => {
    let alive = true
    get(`${id}/metrics?hours=${active}&points=720&series=ping`)
      .then((data) => {
        if (alive) setPings(data)
      })
      .catch(() => {
        // The one optional panel here: a hub with no probes has nothing to draw,
        // and an error banner over a missing convenience panel would bury the
        // figures that did arrive.
        if (alive) setPings({ ping: [], probes: {} })
      })
    return () => {
      alive = false
    }
  }, [id, active])

  const rows = answer?.metrics ?? []
  const plotRows = withGaps(rows)
  const charts = useCharts(rows, node)
  const probes = useProbes(pings?.ping ?? [], pings?.probes, smoothPing, clipPing)

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>) => (key: string) =>
    set((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const toggleNet = toggle(setHiddenNet)
  const togglePing = toggle(setHiddenPing)

  if (error) {
    return (
      <main className="shell">
        <div className="detail-head">
          <button type="button" className="back" onClick={onBack}>
            ← 返回
          </button>
        </div>
        <div className="banner" data-tone="bad">
          {error}
        </div>
      </main>
    )
  }

  if (!node) {
    return (
      <main className="shell">
        <div className="detail-head">
          <button type="button" className="back" onClick={onBack}>
            ← 返回
          </button>
        </div>
        <div className="skeleton tall" />
      </main>
    )
  }

  const m = node.metrics
  const used = usage(node)
  const limit = node.traffic_limit > 0 ? node.traffic_limit : 0

  // The peak is stated rather than only drawn: a 60-second speed test on the
  // hourly tier is one narrow spike that a short chart flattens away.
  const peak = {
    cpu: Math.max(...rows.map((r) => Math.max(r.cpu_max ?? 0, r.cpu)), 0),
    mem: Math.max(...rows.map((r) => r.mem_used), 0),
    disk: Math.max(...rows.map((r) => r.disk_used), 0),
    rx: Math.max(...rows.map((r) => r.net_rx_max ?? r.net_rx), 0),
    tx: Math.max(...rows.map((r) => r.net_tx_max ?? r.net_tx), 0),
  }

  return (
    <main className="shell">
      <div className="detail-head">
        <button type="button" className="back" onClick={onBack}>
          ← 返回
        </button>
        <span className="name">{node.name}</span>
        <Country code={node.country} />
        <span className="lamp">
          <span className="dot" data-state={!node.online ? "off" : node.broken ? "bad" : m ? "ok" : "wait"} />
          {!node.online
            ? `离线 · ${node.last_seen_ago != null ? ago(node.last_seen_ago) : "尚未上报"}`
            : node.broken
              ? "上报异常"
              : m
                ? "在线"
                : "等待上报"}
        </span>
      </div>

      {/* What the machine is, rather than what it is doing: the figures that do
          not change between two visits, read once, kept together so the charts
          below are all movement. */}
      <section className="info">
        <div className="chart-head">
          <span className="chart-title">基础信息</span>
          {m && <span className="chart-note">已运行 {uptime(m.uptime)}</span>}
        </div>
        <div className="specs">
          <Spec k="系统" v={node.os ? osName(node.os) : "—"} />
          <Spec k="内核" v={node.kernel || "—"} />
          <Spec k="架构" v={node.arch || "—"} />
          <Spec k="虚拟化" v={node.virt || "—"} />
          <Spec k="CPU" v={node.cpu_name || "—"} />
          <Spec k="核心" v={node.cpu_cores ? `${node.cpu_cores} 核` : "—"} />
          <Spec k="内存" v={node.mem_total ? bytes(node.mem_total) : "—"} />
          <Spec k="硬盘" v={node.disk_total ? bytes(node.disk_total) : "—"} />
          <Spec k="探针" v={node.agent_version || "—"} />
          <Spec k="主机名" v={node.hostname || "—"} />
        </div>
        <div className="plate">
          {node.price > 0 && (
            <span className="group">
              <span className="k">费用</span>
              <span className="v">
                {money(node.price, node.currency || "")} / {cycle(node.billing_cycle)}
              </span>
            </span>
          )}
          {limit > 0 && (
            <span className="group">
              <span className="k">本月流量</span>
              <span className="v">
                {bytes(used)} / {bytes(limit)}
              </span>
            </span>
          )}
          {node.expires_in != null && (
            <span className="group">
              <span className="k">到期</span>
              <span className="v">{node.expires_in <= 0 ? "已过期" : `${node.expires_in} 天后`}</span>
            </span>
          )}
          {m && (
            <span className="group">
              <span className="k">连接</span>
              <span className="v">
                TCP {m.tcp} · UDP {m.udp} · 进程 {m.procs}
              </span>
            </span>
          )}
          {m && (
            <span className="group">
              <span className="k">负载</span>
              <span className="v">{m.load.map((n) => n.toFixed(2)).join(" · ")}</span>
            </span>
          )}
        </div>
      </section>

      <div className="tabs bar">
        {ranges.map((range) => (
          <button
            key={range.hours}
            type="button"
            className="tab"
            data-on={active === range.hours ? "true" : undefined}
            onClick={() => setHours(range.hours)}
          >
            {range.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="empty">这段时间还没有记录。</div>
      ) : (
        <div className="charts">
          <Panel
            title="CPU"
            note={m ? `当前 ${m.cpu.toFixed(1)}%` : ""}
            foot={`峰值 ${peak.cpu.toFixed(1)}%`}
          >
            <Chart
              rows={plotRows}
              series={[charts.cpu]}
              // The format supplies the sign, so no unit: the readout appends
              // `unit` after `format`, and both gave "37%%".
              format={(n) => `${n.toFixed(0)}%`}
              hours={active}
              top={100}
              ticks={quarters(100)}
            />
          </Panel>

          <Panel
            title="内存"
            note={node.mem_total ? bytes(node.mem_total) : ""}
            foot={`峰值 ${bytes(peak.mem)}`}
          >
            <Chart
              rows={plotRows}
              series={[charts.memory]}
              format={axisBytes}
              unit="B"
              hours={active}
              top={charts.memTop}
            />
          </Panel>

          <Panel
            title="硬盘"
            note={node.disk_total ? bytes(node.disk_total) : ""}
            foot={`峰值 ${bytes(peak.disk)}`}
          >
            <Chart
              rows={plotRows}
              series={[charts.disk]}
              format={axisBytes}
              unit="B"
              hours={active}
              top={charts.diskTop}
            />
          </Panel>

          <Panel title="网络" foot={`峰值 ↓${byteRate(peak.rx)} ↑${byteRate(peak.tx)}`}>
            <Chart
              rows={plotRows}
              series={[charts.netRx, charts.netTx]}
              format={axisBytes}
              unit="B/s"
              hours={active}
              domain={charts.netAxis.domain}
              ticks={charts.netAxis.ticks}
              hidden={hiddenNet}
              onToggle={toggleNet}
            />
          </Panel>

          <Panel
            title="三网延迟"
            className="wide"
            note={probes.series.length ? `${probes.series.length} 个探针` : ""}
            tools={
              probes.series.length ? (
                <>
                  <button
                    type="button"
                    className="chip"
                    data-on={smoothPing ? "true" : undefined}
                    aria-pressed={smoothPing}
                    onClick={() => setSmoothPing((on) => !on)}
                    title="把相邻的几个采样取平均，去掉抖动，留下走势"
                  >
                    平滑
                  </button>
                  <button
                    type="button"
                    className="chip"
                    data-on={clipPing ? "true" : undefined}
                    aria-pressed={clipPing}
                    onClick={() => setClipPing((on) => !on)}
                    title="把明显偏离邻近取值的尖峰换成邻近的中位数"
                  >
                    削峰
                  </button>
                </>
              ) : null
            }
            foot={
              probes.series.length
                ? [
                    hiddenPing.size && probes.series.some((s) => hiddenPing.has(s.id))
                      ? "点击图例恢复全部"
                      : "点击图例只看一个探针",
                    smoothPing || clipPing
                      ? `曲线经过${[smoothPing ? "平滑" : "", clipPing ? "削峰" : ""].filter(Boolean).join("与")}处理，关闭任一开关可看原始采样`
                      : "原始采样",
                  ].join(" · ")
                : ""
            }
          >
            {probes.series.length === 0 ? (
              <div className="chart-empty">没有可用的延迟探针。</div>
            ) : (
              <Chart
                rows={probes.rows}
                series={probes.series}
                format={(n) => `${n.toFixed(0)}ms`}
                unit="ms"
                hours={active}
                top={probes.top}
                ticks={quarters(probes.top)}
                hidden={hiddenPing}
                onToggle={togglePing}
              />
            )}
          </Panel>
        </div>
      )}
    </main>
  )
}

/** A chart with its frame and its captions. */
function Panel({
  title,
  note,
  foot,
  tools,
  className,
  children,
}: {
  title: string
  note?: string
  foot?: string
  /** Small switches belonging to this panel, pinned to the right of its head. */
  tools?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className ? `chart ${className}` : "chart"}>
      <div className="chart-head">
        <span className="chart-title">{title}</span>
        {note && <span className="chart-note">{note}</span>}
        {tools && <span className="chart-tools">{tools}</span>}
      </div>
      {children}
      {foot && <div className="chart-foot">{foot}</div>}
    </div>
  )
}

function Spec({ k, v }: { k: string; v: string }) {
  return (
    <div className="spec">
      <div className="k">{k}</div>
      <div className="v" title={v}>
        {v}
      </div>
    </div>
  )
}
