import { useMemo } from "react"
import { useFlag, useText } from "@/lib/theme"
import type { Node } from "@/lib/api"
import { bytes, money, monthlyCost, monthUsage, rate, residualValue } from "@/lib/format"
import { rate as convert, useCostRates } from "@/lib/cost"

/**
 * The four figures that describe the whole fleet, above the cards.
 *
 * They answer what no single card can: how many machines there are, how much of
 * this month's allowance the fleet has spent, what the network is doing right
 * now, and what all of it costs. Every figure is a sum over the same array the
 * grid is drawn from, so the two can never disagree.
 */

/** One tile: a label, and a figure with an optional detail under it. */
function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      {children}
    </div>
  )
}

/**
 * 节点数: how many machines there are, and how many are up.
 *
 * One figure rather than two tiles: "在线" without the total is a number with
 * nothing to compare it to, and splitting them spends a quarter of the strip on
 * the same count twice. The dot beside the total is green only when every
 * machine is up, so the colour is the first thing read and the figures the second.
 */
function Count({ nodes }: { nodes: Node[] }) {
  const online = nodes.filter((node) => node.online).length
  const all = nodes.length
  const tone = all > 0 && online === all ? "ok" : online === 0 ? "off" : "wait"
  return (
    <Tile label="节点数">
      <div className="v">
        <span className="bulb" data-tone={tone} />
        {all}
      </div>
      <div className="sub">
        {online} 在线 · {all - online} 离线
      </div>
    </Tile>
  )
}

/**
 * 本月流量: what the fleet has moved this month, against the allowance it was
 * given.
 *
 * Only nodes that have a quota at all contribute to the total: an unlimited
 * machine's traffic is not part of anything anyone paid for, and counting it
 * would make the fleet look closer to its limit than it is. With no quotas to
 * add up the figure is the plain total and the detail says so.
 */
function Traffic({ nodes }: { nodes: Node[] }) {
  let used = 0
  let limit = 0
  let metered = 0
  for (const node of nodes) {
    const spent = monthUsage(node)
    used += spent
    if (node.traffic_limit > 0) {
      limit += node.traffic_limit
      metered++
    }
  }

  if (nodes.length === 0) {
    return (
      <Tile label="本月流量">
        <div className="v">—</div>
      </Tile>
    )
  }

  return (
    <Tile label="本月流量">
      <div className="v">{bytes(used)}</div>
      <div className="sub">{limit > 0 ? `配额 ${bytes(limit)} · ${metered} 台` : "不限量"}</div>
    </Tile>
  )
}

/**
 * 实时网速: what the fleet is moving right now.
 *
 * Up and down side by side rather than summed: they are billed separately on
 * almost every host, and their sum describes no actual link.
 */
function Speed({ nodes }: { nodes: Node[] }) {
  let up = 0
  let down = 0
  let reporting = 0
  for (const node of nodes) {
    const m = node.metrics
    if (!m) continue
    reporting++
    up += m.net_tx
    down += m.net_rx
  }

  if (reporting === 0) {
    return (
      <Tile label="实时网速">
        <div className="v">—</div>
      </Tile>
    )
  }

  return (
    <Tile label="实时网速">
      <div className="v pair">
        <span>↑{rate(up)}</span>
        <span>↓{rate(down)}</span>
      </div>
      <div className="sub">{reporting} 台在上报</div>
    </Tile>
  )
}

/**
 * 费用: what the fleet costs per month, and what is left of what was paid.
 *
 * Prices arrive in whatever currency each host bills in. With a display currency
 * chosen they are converted; without one they cannot be added, so the tile states
 * each currency separately rather than a total that silently treats 12 USD and
 * 180 CNY as 192 of something. A free machine is skipped outright: it has no
 * currency at all, and asking the converter about an empty code is what once
 * removed this whole tile.
 */
function Cost({ nodes }: { nodes: Node[] }) {
  const currency = useText("currency", "")
  const rates = useCostRates()

  const { byCurrency, missing } = useMemo(() => {
    const byCurrency = new Map<string, { per: number; left: number }>()
    for (const node of nodes) {
      const per = monthlyCost(node)
      const left = residualValue(node)
      // A free machine still belongs in the sum. Skipping it looked harmless --
      // adding zero cannot change a total -- but it left the map empty when every
      // machine in view was free or unpriced, and an empty map took the whole
      // tile off the strip. The strip is four positions; a reader who sees three
      // cannot tell whether the fourth is hidden, broken, or zero.
      const code = node.currency || ""
      const at = byCurrency.get(code) ?? { per: 0, left: 0 }
      at.per += per
      at.left += left
      byCurrency.set(code, at)
    }

    if (!currency) return { byCurrency, missing: false }

    let per = 0
    let left = 0
    let missing = false
    for (const [code, at] of byCurrency) {
      // A machine with no price and no residue converts to nothing whatever the
      // rate is, and asking for a rate for an empty currency code -- which is
      // what a free plan sends -- always fails. Treat zero as zero rather than as
      // a failed conversion, or one free machine takes the fleet total with it.
      if (at.per === 0 && at.left === 0) continue
      const p = convert(at.per, code, currency, rates)
      const l = convert(at.left, code, currency, rates)
      if (p === null || l === null) {
        missing = true
        continue
      }
      per += p
      left += l
    }
    byCurrency.clear()
    byCurrency.set(currency, { per, left })
    return { byCurrency, missing }
  }, [nodes, currency, rates])

  // A conversion that did not come back answers nothing: showing the raw figures
  // under a tile whose label promises one currency would be worse than none.
  if (currency && missing) return null

  const bills = [...byCurrency.entries()].filter(([, at]) => at.per > 0 || at.left > 0)

  // Everything in view is free or unpriced. That is a real answer, and the tile
  // says so instead of vanishing.
  if (bills.length === 0) {
    const free = nodes.length > 0 && nodes.every((n) => monthlyCost(n) === 0)
    return (
      <Tile label="费用">
        <div className="v" data-quiet="true">
          {free ? "免费" : "—"}
        </div>
        <div className="sub">
          {free ? (currency ? "全部免费" : "全部免费") : "未标价"}
        </div>
      </Tile>
    )
  }

  // One currency: the figure the tile is about. Several, and no conversion
  // asked for: they are shown as separate figures rather than joined by a slash,
  // because "US$51.00 / ¥15.00" reads as one amount written two ways instead of
  // two amounts that nothing has added up.
  const sorted = currency ? bills : [...bills].sort((a, b) => b[1].per - a[1].per)
  const [code, at] = sorted[0]
  const rest = sorted.length - 1

  const sub = currency
    ? `剩余价值 ${money(at.left, currency)}`
    : rest > 0
      ? `${rest} 种币种未折算`
      : `剩余价值 ${money(at.left, code)}`

  return (
    <Tile label="费用">
      <div className="v">{money(at.per, code)}</div>
      <div className="sub">{sub}</div>
    </Tile>
  )
}

export function Summary({ nodes }: { nodes: Node[] }) {
  const showSummary = useFlag("show_summary", true)
  if (!showSummary) return null

  return (
    <div className="summary">
      <Count nodes={nodes} />
      <Traffic nodes={nodes} />
      <Speed nodes={nodes} />
      <Cost nodes={nodes} />
    </div>
  )
}
