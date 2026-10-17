import { useCardStyle } from "@/lib/style"
import { ago, bytes, percent, rate } from "@/lib/format"
import type { Node } from "@/lib/api"

/**
 * The country, as the two letters the hub sends.
 *
 * Not an emoji flag: a flag emoji is a pair of regional-indicator code points, and
 * a system without a matching emoji font renders it as four letters and two
 * boxes. Two letters in a bordered box read the same everywhere.
 */
export function Country({ code }: { code: string }) {
  const cc = (code || "").toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return null
  return <span className="cc">{cc}</span>
}

/**
 * The month's traffic as the node's own plan meters it.
 *
 * `month_used` is what the hub reports when the plan has a reset day of its own;
 * otherwise it is the sum of the two directions since `month_start`. Both are in
 * the response, so the card never has to guess which one applies.
 */
export function usage(node: Node): number {
  if (typeof node.month_used === "number") return node.month_used
  return (node.month_rx ?? 0) + (node.month_tx ?? 0)
}

/** Why a card has no figures to show, for the dot's tooltip. */
function quiet(node: Node): string {
  if (node.broken) return "上报数据异常"
  if (node.online) return "已连接，等待首次上报"
  const seen = node.last_seen_ago
  if (seen === undefined || seen === null) return "尚未上报"
  return `${ago(seen)}离线`
}

/** The bar's colour, from the share of the thing it is measuring. */
function heat(share: number | null): "warn" | "bad" | undefined {
  if (share === null) return undefined
  if (share >= 90) return "bad"
  if (share >= 70) return "warn"
  return undefined
}

/**
 * One measured column: a label, a figure, and -- for the three that are a share
 * of a total -- a bar under them.
 *
 * The bar is passed as `null` when the row exists but the node has not reported:
 * that draws the empty track, so a node with no data keeps the same height as its
 * neighbours. `undefined` means the column has no bar at all.
 */
function Col({
  label,
  children,
  bar,
  tone,
  mono = true,
}: {
  label: string
  children: React.ReactNode
  bar?: number | null
  tone?: "warn" | "bad"
  mono?: boolean
}) {
  return (
    <div className="col">
      <span className="k">{label}</span>
      <span className="v" data-mono={mono ? undefined : "false"}>
        {children}
      </span>
      {bar !== undefined && (
        <span className="track" data-empty={bar === null ? "true" : undefined}>
          {bar !== null && (
            <span
              className="fill"
              data-tone={tone}
              style={{ width: `${Math.max(0, Math.min(100, bar))}%` }}
            />
          )}
        </span>
      )}
    </div>
  )
}

/**
 * The two cumulative-traffic bars: 总上传 and 总下载 side by side under the
 * measured columns.
 *
 * They share the row rather than each taking a column, because they are the two
 * halves of one figure -- the traffic this machine has moved since it was
 * installed -- and a column apiece would make each look like a separate reading
 * of the same kind as CPU.
 */
function Totals({ tx, rx }: { tx: number | null; rx: number | null }) {
  return (
    <div className="totals">
      <span className="total">
        <span className="k">总上传</span>
        <span className="v">{tx === null ? "—" : bytes(tx)}</span>
      </span>
      <span className="total">
        <span className="k">总下载</span>
        <span className="v">{rx === null ? "—" : bytes(rx)}</span>
      </span>
    </div>
  )
}

export function NodeCard({ node, onOpen }: { node: Node; onOpen: (id: number) => void }) {
  const style = useCardStyle()
  const m = node.metrics
  const state = !node.online ? "off" : node.broken ? "bad" : m ? "ok" : "wait"
  const stateText = !node.online ? "离线" : node.broken ? "上报异常" : m ? "在线" : "等待上报"

  const cpu = m ? percent(m.cpu, 100) : null
  const mem = m ? percent(m.mem_used, m.mem_total) : null
  const disk = m ? percent(m.disk_used, m.disk_total) : null

  return (
    <button
      type="button"
      className="card"
      data-offline={!node.online ? "true" : undefined}
      onClick={() => onOpen(node.id)}
    >
      {/* The identity, centred above the figures. It reads as the card's title
          rather than as the first cell of a table: everything under it describes
          this machine, and the name is what the row is about. */}
      <div className="who">
        <span className="dot" data-state={state} title={`${stateText} · ${quiet(node)}`} />
        {style.showFlags && <Country code={node.country} />}
        <span className="name" title={node.name}>
          {node.name}
        </span>
      </div>

      <div className="cols">
        <Col label="CPU" children={m ? `${m.cpu.toFixed(2)}%` : "—"} bar={cpu} tone={heat(cpu)} />
        <Col
          label="内存"
          children={m ? `${percent(m.mem_used, m.mem_total).toFixed(2)}%` : "—"}
          bar={mem}
          tone={heat(mem)}
        />
        <Col
          label="存储"
          children={m ? `${percent(m.disk_used, m.disk_total).toFixed(2)}%` : "—"}
          bar={disk}
          tone={heat(disk)}
        />
        {style.showNet && (
          <>
            <Col label="上传" children={m ? rate(m.net_tx) : "—"} mono={false} />
            <Col label="下载" children={m ? rate(m.net_rx) : "—"} mono={false} />
          </>
        )}
      </div>

      {style.showTraffic && <Totals tx={m ? m.total_tx : null} rx={m ? m.total_rx : null} />}
    </button>
  )
}
