import { useCardStyle } from "@/lib/style"
import { FOREVER, ago, bytes, cycle, money, percent, rate } from "@/lib/format"
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

/**
 * One measured column: a label and a figure.
 *
 * There is no bar under them. The bar was a share of a total drawn five times
 * across the width of the card, and it forced the row into a ten-track grid that
 * the band beneath could not divide evenly -- five columns and two bars share no
 * common boundary, so either the bars lost their seam or the figures got
 * truncated. The figures are the content; a 3px strip repeating "42%" as a
 * length says nothing the digits did not, and removing it lets the row and the
 * band above use one grid each.
 *
 * `mono` is off for the two rates, whose unit already sets their width.
 */
function Col({
  label,
  children,
  mono = true,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="col">
      <span className="k">{label}</span>
      <span className="v" data-mono={mono ? undefined : "false"}>
        {children}
      </span>
    </div>
  )
}

/**
 * The band under the columns: the two cumulative-traffic bars, and the plan
 * under them.
 *
 * The whole card body is one grid of ten tracks: each measured column spans two
 * and each bar spans five, so the bars fall on the same boundaries as the
 * columns above them. As two independent five- and two-column grids their
 * boundaries land at unrelated places and the bars read as a different table.
 *
 * The plan capsules follow the same rule, price over five tracks, expiry over
 * the other five.
 */
function Band({
  tx,
  rx,
  price,
  expire,
  renew,
}: {
  tx: number | null
  rx: number | null
  price: string
  expire: string
  renew?: "warn" | "bad"
}) {
  return (
    <>
      <span className="total">
        <span className="k">总上传</span>
        <span className="v">{tx === null ? "—" : bytes(tx)}</span>
      </span>
      <span className="total">
        <span className="k">总下载</span>
        <span className="v">{rx === null ? "—" : bytes(rx)}</span>
      </span>
      <span className="total plan" data-empty={price === "—" ? "true" : undefined}>
        <span className="k">费用</span>
        <span className="v">{price}</span>
      </span>
      <span className="total plan" data-tone={renew} data-empty={expire === "—" ? "true" : undefined}>
        <span className="k">到期</span>
        <span className="v">{expire}</span>
      </span>
    </>
  )
}

export function NodeCard({ node, onOpen }: { node: Node; onOpen: (id: number) => void }) {
  const style = useCardStyle()
  const m = node.metrics
  const state = !node.online ? "off" : node.broken ? "bad" : m ? "ok" : "wait"
  const stateText = !node.online ? "离线" : node.broken ? "上报异常" : m ? "在线" : "等待上报"


  // The plan. `expires_in` is the hub's own count of days: the browser's clock
  // is not the authority on whether a machine has expired, and a laptop across
  // the date line would otherwise disagree with the hub about it.
  const days = node.expires_in ?? null
  const priced = typeof node.price === "number" && node.price > 0
  const price = !priced
    ? "免费"
    : node.currency
      ? `${money(node.price as number, node.currency)}${node.billing_cycle ? ` / ${cycle(node.billing_cycle)}` : ""}`
      : money(node.price as number, "")
  const expire =
    days === null
      ? FOREVER
      : days <= 0
        ? "已过期"
        : days <= 30
          ? `${days} 天后到期`
          : (node.expires_at ? node.expires_at.slice(0, 10) : `${days} 天后到期`)

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
        <Col label="CPU" children={m ? `${m.cpu.toFixed(2)}%` : "—"} />
        <Col label="内存" children={m ? `${percent(m.mem_used, m.mem_total).toFixed(2)}%` : "—"} />
        <Col label="硬盘" children={m ? `${percent(m.disk_used, m.disk_total).toFixed(2)}%` : "—"} />
        {style.showNet && (
          <>
            <Col label="上传" children={m ? rate(m.net_tx) : "—"} mono={false} />
            <Col label="下载" children={m ? rate(m.net_rx) : "—"} mono={false} />
          </>
        )}
      </div>

      <Band
        tx={m && style.showTraffic ? m.total_tx : null}
        rx={m && style.showTraffic ? m.total_rx : null}
        price={style.showPrice ? price : "—"}
        expire={style.showPrice ? expire : "—"}
        renew={
          style.showPrice && days !== null && days <= 0 ? "bad" : style.showPrice && days !== null && days <= 7 ? "warn" : undefined
        }
      />
    </button>
  )
}
