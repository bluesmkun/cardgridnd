const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"]

const unitOf = (n: number) => Math.min(Math.floor(Math.log(n) / Math.log(1024)), UNITS.length - 1)

/**
 * 1024-based, as VPS dashboards and `df` report bytes, but labelled MB/GB the way
 * `df -h` and hosting plans write them: no plan is sold as "1000 GiB".
 */
export function bytes(n: number, digits?: number): string {
  if (!n || n < 1) return "0 B"
  const i = unitOf(n)
  const v = n / 1024 ** i
  return `${v.toFixed(i === 0 ? 0 : (digits ?? (v >= 100 ? 0 : v >= 10 ? 1 : 2)))} ${UNITS[i]}`
}

/** A "used / total" pair. Sharing a unit means writing it once. */
export function pair(used: number, total: number): string {
  if (used > 0 && total > 0 && unitOf(used) === unitOf(total)) {
    const i = unitOf(total)
    const f = (n: number) => (n / 1024 ** i).toFixed(i === 0 ? 0 : 2)
    return `${f(used)} / ${f(total)} ${UNITS[i]}`
  }
  return `${bytes(used)} / ${bytes(total)}`
}

export function rate(n: number): string {
  return `${bytes(n, 1)}/s`
}

/**
 * A byte quantity for a chart's y axis. Rounded to at most two decimals with
 * trailing zeros trimmed, which matters because the gridlines are quarters of the
 * top: a 2 GB memory axis has a gridline at 1.5 GB, and formatting that with no
 * decimals -- as a fixed `bytes(n, 0)` would -- prints "2 GB" under a "2 GB"
 * axis top, so two of the five labels read the same.
 */
export function axisBytes(n: number): string {
  if (!n || n < 1) return "0 B"
  const i = unitOf(n)
  const v = n / 1024 ** i
  return `${Number(v.toFixed(i === 0 ? 0 : 2))} ${UNITS[i]}`
}

/** Not capped: a plan used past its quota reads as 209%, not 100%. */
export function percent(used: number, total: number): number {
  return total > 0 ? (used / total) * 100 : 0
}

export function uptime(seconds: number): string {
  if (!seconds) return "—"
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return d > 0 ? `${d} 天 ${h} 小时` : h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`
}

/**
 * A hub date as a local midnight.
 *
 * `expires_at` is not pinned down to one shape by the contract: a bare
 * `YYYY-MM-DD` and a full ISO stamp both occur, and appending a time to a stamp
 * that already has one produces an Invalid Date -- which would silently turn
 * every date comparison false rather than fail loudly. So the bare form gets a
 * time and the stamp is used as it is, then both are reduced to the local
 * calendar day, because a hub date is a day, not an instant.
 */
function dayStart(value: string): number | null {
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const parsed = new Date(bare ? `${value}T00:00:00` : value)
  if (Number.isNaN(parsed.getTime())) return null
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime()
}

/** Whole days until a date, negative once it has passed. */
export function daysUntil(date?: string | null): number | null {
  if (!date) return null
  const target = dayStart(date)
  if (target === null) return null
  return Math.ceil((target - Date.now()) / 86400000)
}

/** No expiry and no traffic cap are both rendered as the absence of a ceiling. */
export const FOREVER = "∞"

const MONEY = new Map<string, Intl.NumberFormat>()

/**
 * A price as zh-CN writes it: ¥12.00, US$12.00, HK$12.00, JP¥1,200, and the code
 * ahead of the amount where the locale has no symbol. The locale is fixed so the
 * figure does not vary with the browser's language, and so JPY reads JP¥, apart
 * from CNY. Fractions stop at two places, the precision the price is entered in.
 */
export function money(amount: number, currency: string): string {
  try {
    let format = MONEY.get(currency)
    if (!format) {
      format = new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 2 })
      MONEY.set(currency, format)
    }
    return format.format(amount)
  } catch {
    // Intl throws on anything but three letters, which hubs before 1.3.1 stored
    // unchecked when written through the API.
    return `${currency} ${amount.toFixed(2)}`.trim()
  }
}

// Hub 1.3.0 and earlier store only these names; later hubs store any other
// length as `<n>m`.
const NAMED_CYCLES: Record<string, number> = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12, biennial: 24, triennial: 36 }
const CYCLE_WORDS: Record<number, string> = { 1: "月付", 3: "季付", 6: "半年付", 12: "年付" }

/** How a billing cycle reads: 月付, 5 年付, 18 个月付, 一次性. */
export function cycle(billing: string): string {
  if (billing === "once") return "一次性"
  const months = NAMED_CYCLES[billing] ?? Number(/^(\d+)m$/.exec(billing)?.[1])
  if (!months) return billing
  return CYCLE_WORDS[months] ?? (months % 12 ? `${months} 个月付` : `${months / 12} 年付`)
}

/**
 * How many months a cycle covers, or 0 for a one-off. 0 is the honest answer for
 * `once`: the money was spent when it was bought, so it has no monthly cost, and
 * treating it as a month would silently inflate the fleet's running total.
 */
export function cycleMonths(billing: string): number {
  if (billing === "once") return 0
  const months = NAMED_CYCLES[billing] ?? Number(/^(\d+)m$/.exec(billing)?.[1])
  return Number.isFinite(months) && months > 0 ? months : 0
}

/**
 * What a node costs per month. The hub stores a price and the cycle it is paid
 * over, so a 90m plan at $90 is $1/month -- dividing is the only way a total
 * across differently-billed nodes means anything.
 */
export function monthlyCost(node: { price: number; billing_cycle: string }): number {
  if (!(node.price > 0)) return 0
  const months = cycleMonths(node.billing_cycle)
  return months > 0 ? node.price / months : 0
}

/**
 * What a node is still worth: the part of its period that has not run out yet.
 *
 * The hub stores a price, the cycle it covers, and the date it renews, so the
 * remaining value is the price spread evenly over the cycle and cut at today:
 * a $120 yearly plan with 90 days left is worth $120 * 90/365. That is the
 * straight-line reading of a prepaid period, and it is the one that answers
 * "how much have I already paid for time I have not used".
 *
 * Two shapes have no remaining period and are worth 0, not their price:
 *
 *   `once`     the money was spent when it was bought, and there is no period
 *              running down -- the same reason it has no monthly cost;
 *   no expiry  a node that never expires has no date to count down to, so
 *              there is no share of it that has "run out".
 *
 * An expired node is 0 too: the period is over, whatever it was worth before.
 */
export function residualValue(node: { price: number; billing_cycle: string; expires_at?: string | null; expires_in?: number | null }): number {
  const price = node.price
  if (!(price > 0)) return 0
  const months = cycleMonths(node.billing_cycle)
  // No period, no expiry: nothing is running down. See the two shapes above.
  if (months <= 0) return 0
  // `expires_in` is the hub's own day count and is already in the hub's
  // calendar; only fall back to the stored date when it is absent, the way the
  // card's own badge does. `null` there means "no expiry", not "unknown".
  const left = node.expires_in !== undefined ? node.expires_in : daysUntil(node.expires_at)
  if (left === null || left === undefined || left <= 0) return 0
  // A cycle's own length, in days, from the months it covers. The hub bills in
  // whole months, so 30.44 days each is closer to a year than 365/12 rounded.
  const span = months * (365.25 / 12)
  // A remaining span longer than the cycle is a clock disagreement, not a
  // bargain: cap it so a stale `expires_in` cannot report more value than the
  // node was bought for.
  return price * Math.min(left / span, 1)
}

/**
 * Whether a node's renewal falls in the calendar month the viewer is in. This is
 * the one figure on the page that uses the browser's clock, because "this month"
 * is a question about the reader's calendar rather than about the hub's: the
 * operator asks what is about to be charged, and `expires_in` counts days, which
 * cannot answer which month a date lands in.
 */
export function dueThisMonth(expires?: string | null, now = new Date()): boolean {
  if (!expires) return false
  const target = dayStart(expires)
  if (target === null) return false
  const at = new Date(target)
  return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth()
}

/**
 * This period's usage as the plan meters it. The hub computes it; the switch
 * below serves only a hub from before `month_used`.
 */
export function monthUsage(node: {
  month_used?: number
  month_rx: number
  month_tx: number
  traffic_mode: string
}): number {
  if (typeof node.month_used === "number") return node.month_used
  const { month_rx: rx, month_tx: tx } = node
  switch (node.traffic_mode) {
    case "up":
      return tx
    case "down":
      return rx
    case "max":
      return Math.max(rx, tx)
    default:
      return rx + tx
  }
}

/** `traffic_mode` as a word, for the card's quota line. */
export function trafficMode(mode: string): string {
  switch (mode) {
    case "up":
      return "只算上行"
    case "down":
      return "只算下行"
    case "max":
      return "取较大方向"
    case "sum":
      return "双向合计"
    default:
      return ""
  }
}

/**
 * Seconds since the node last reported, as the hub counts them: subtracted on
 * the visitor's clock, a browser eight hours fast would show a node that dropped
 * a minute ago as offline for eight hours. The browser's clock serves only a hub
 * from before `last_seen_ago`.
 */
export function sinceSeen(node: { last_seen: number; last_seen_ago?: number | null }): number {
  if (node.last_seen_ago !== undefined) return node.last_seen_ago ?? 0
  return node.last_seen ? Date.now() / 1000 - node.last_seen : 0
}

/** "3 分钟前", from seconds. */
export function ago(seconds: number): string {
  if (seconds < 60) return "刚刚"
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  return `${Math.floor(seconds / 86400)} 天前`
}

/**
 * Distro and CPU names as vendors write them carry mostly redundant text: a
 * codename in brackets, "GNU/Linux", "(R)", a core count already printed
 * separately. Stripping it is what makes the line fit.
 */
export function osName(name: string): string {
  return name.replace("GNU/Linux ", "").replace(/\s*\([^)]*\)\s*$/, "")
}

export function cpuName(name: string): string {
  return name
    .replace(/\((R|TM|r|tm)\)/g, "")
    .replace(/\s+(CPU|Processor)\b/g, "")
    .replace(/\s+\d+-Core\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

// Round chart windows, in hours: up to a week they are drawn from minute rows,
// past it from the hub's hourly tier.
const WINDOWS = [1, 6, 24, 168, 720, 2160]

/**
 * The chart windows offered for a hub keeping `days` of history, which `/api/me`
 * reports as `history_days`: the round windows shorter than it, then the whole
 * of it. A window past it would be narrowed by the hub without saying so, and
 * drawn under a label claiming more than it holds. A round window the whole
 * exceeds by less than a quarter is left out, as it would sit beside a tab of
 * nearly the same width: 30 and 31 days, 90 and 92.
 */
export function windows(days: number): { hours: number; label: string }[] {
  const whole = Math.max(1, Math.floor(days)) * 24
  return [...WINDOWS.filter((h) => h * 1.25 <= whole), whole].map((hours) => ({
    hours,
    label: hours < 24 ? `${hours} 小时` : hours === 8760 ? "1 年" : `${hours / 24} 天`,
  }))
}

// Built once: an Intl formatter constructed per call would be the largest single
// cost on the detail page. They take epoch milliseconds, as Date does.
const HHMM = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" })
const MDHHMM = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
const MMDD = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" })

/**
 * Axis ticks for a window `hours` wide. Beyond a day a bare "14:00" recurs each
 * midnight and the axis no longer indicates which day it refers to.
 */
export function clockFor(hours: number): (ms: number) => string {
  return hours <= 24 ? HHMM.format : MDHHMM.format
}

/** The date alone once every tick is a local midnight, `clockFor` otherwise. */
export function tickClock(ticks: number[], hours: number): (ms: number) => string {
  const midnight = (t: number) => new Date(t).getHours() === 0 && new Date(t).getMinutes() === 0
  return ticks.length > 0 && ticks.every(midnight) ? MMDD.format : clockFor(hours)
}

// Ticks on round clock values across `[from, to]`, in epoch milliseconds.
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080, 20160].map((m) => m * 60_000)
const TICK_MONTHS = [1, 2, 3, 6, 12]

export function timeTicks(from: number, to: number, count = 8): number[] {
  const step = TICK_STEPS.find((s) => (to - from) / s <= count)
  if (step === undefined) return monthTicks(from, to, count)
  const zone = new Date(from).getTimezoneOffset() * 60_000
  const ticks: number[] = []
  for (let t = Math.ceil((from - zone) / step) * step + zone; t <= to; t += step) {
    // Past a daylight-saving change a step of days lands an hour off midnight,
    // so each such tick is set back on the nearest one.
    const tick = step < 86_400_000 ? t : new Date(t + 43_200_000).setHours(0, 0, 0, 0)
    if (tick <= to) ticks.push(tick)
  }
  return ticks
}

// The first of every `every`th month within `[from, to]`, on months divisible
// by `every` so a quarterly axis reads January, April, July.
function monthTicks(from: number, to: number, count: number): number[] {
  const start = new Date(from)
  const every = TICK_MONTHS.find((k) => (to - from) / (k * 30 * 86_400_000) <= count) ?? 12
  let month = start.getFullYear() * 12 + start.getMonth()
  if (new Date(start.getFullYear(), start.getMonth(), 1).getTime() < from) month++
  const ticks: number[] = []
  for (month = Math.ceil(month / every) * every; ; month += every) {
    const t = new Date(Math.floor(month / 12), month % 12, 1).getTime()
    if (t > to) return ticks
    ticks.push(t)
  }
}

/** Round multipliers spanning a decade, so `axisTop` always finds one. */
const LADDER = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]

/**
 * A zero-anchored axis top for a utilisation percentage, which has no capacity
 * to measure against. Derived from the gridline rather than the reverse -- the
 * smallest round step whose fourth multiple clears the data.
 *
 * `floor` keeps an idle machine looking idle: tracked exactly, a host that never
 * exceeds 0.4% CPU would get an axis of 0-0.4 and render every scheduler blip as
 * a peak.
 */
export function axisTop(max: number, floor: number, cap: number): number {
  const target = Math.min(cap, Math.max(max, floor)) / 4
  const scale = 10 ** Math.floor(Math.log10(target))
  return Math.min(cap, LADDER.find((m) => m * scale >= target)! * scale * 4)
}

/** The gridlines for a zero-anchored axis: the top and the three quarters beneath it. */
export function quarters(top: number): number[] {
  return [0, 0.25, 0.5, 0.75, 1].map((f) => top * f)
}

/**
 * A zero-anchored axis top for a byte quantity, rounded up to a round value in
 * its own unit, so memory and disk panels end on a label like "2 GB".
 */
export function bytesTop(max: number, floor: number): number {
  const target = Math.max(max, floor)
  const unit = 1024 ** Math.floor(Math.log(target) / Math.log(1024))
  const v = target / unit
  const step = LADDER.find((m) => m >= v) ?? 10
  return step * unit
}

/**
 * `rows` with an empty row in each gap over twice their usual spacing, where a
 * chart breaks its line rather than drawing a straight one across a stretch with
 * no samples -- a day offline would read as a day of steady load. The usual
 * spacing is the median gap rather than the hub's bucket: an agent reporting
 * every few minutes leaves a row only every few buckets.
 */
export function withGaps<T extends { ts: number }>(rows: T[]): (T | { ts: number })[] {
  if (rows.length < 2) return rows
  const gaps = rows.slice(1).map((r, i) => r.ts - rows[i].ts).sort((a, b) => a - b)
  // The lower median: of two gaps, the shorter is the spacing and the longer the
  // one in question.
  const usual = gaps[(gaps.length - 1) >> 1]
  if (!usual) return rows
  return rows.flatMap((r, i) =>
    i > 0 && r.ts - rows[i - 1].ts > 2 * usual ? [{ ts: (r.ts + rows[i - 1].ts) / 2 }, r] : [r],
  )
}

/** The rungs of a logarithmic byte axis: 1, 10 and 100 of each binary unit. */
const rung = (i: number) => 1024 ** Math.floor(i / 3) * 10 ** (i % 3)

/** The rung of `RATE_FLOOR`. */
const FLOOR = 3

/**
 * The lowest rate drawn, 1 KB/s, since a log axis has no zero. An agent's own
 * reports run below it, so a node doing nothing else lies along the floor rather
 * than drawing that traffic, magnified, as activity.
 */
export const RATE_FLOOR = rung(FLOOR)

/**
 * A logarithmic axis for transfer rates, from the rung at or below `low` to the
 * rung at or above `high`, and no lower than `RATE_FLOOR`. At most six labels.
 */
export function rateAxis(low: number, high: number): { domain: [number, number]; ticks: number[] } {
  let bottom = FLOOR
  while (rung(bottom + 1) <= Math.min(low, high)) bottom++
  let top = bottom + 1
  while (rung(top) < high) top++
  const step = Math.ceil((top - bottom) / 5)
  const ticks: number[] = []
  for (let i = top; i >= bottom; i -= step) ticks.unshift(rung(i))
  return { domain: [rung(bottom), rung(top)], ticks }
}

/**
 * Hampel filter (Hampel 1974). A sample more than `sigmas` robust deviations
 * from the median of its window is replaced by that median, while everything
 * else passes through unchanged, which is what separates it from a rolling
 * median: a period that is genuinely slow keeps its height, since its own
 * neighbours are slow too.
 *
 * The deviation is floored at one millisecond, the resolution round trips are
 * stored in; unfloored, a window whose samples mostly repeat one value has a
 * deviation of exactly 0 and the test then rejects everything or nothing.
 */
export function despike(values: (number | null)[], window = 7, sigmas = 3): (number | null)[] {
  const half = window >> 1
  return values.map((v, i) => {
    if (v === null) return v
    const near = values.slice(Math.max(0, i - half), i + half + 1).filter((n): n is number => n !== null)
    const mid = median(near)
    const mad = Math.max(median(near.map((n) => Math.abs(n - mid))), 1)
    return Math.abs(v - mid) > sigmas * 1.4826 * mad ? mid : v
  })
}

/** The middle of a sorted copy, the mean of the middle pair for an even count. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const half = sorted.length >> 1
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2
}

/**
 * A trailing rolling mean over the nearest `window` samples that have values,
 * truncated at the ends so the first and last readings survive.
 *
 * This is the smoothing half of the pair; the spike filter above decides which
 * samples count as neighbours, and this one decides what a sample is worth next
 * to them. Unlike the filter it moves a genuine slow period rather than
 * clipping it: a minute that really did take 300 ms has slow neighbours and a
 * slow average, where a one-sample jump into 4 000 ms does not survive either.
 *
 * Nulls are skipped rather than counted as zero: a probe that timed out for a
 * few samples must not drag its neighbours towards zero, which would draw a
 * connection failure as a fast network.
 */
export function movingAverage(values: (number | null)[], window = 7): (number | null)[] {
  const half = window >> 1
  return values.map((v, i) => {
    if (v === null) return v
    const near: number[] = []
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j += 1) {
      const n = values[j]
      if (n !== null && Number.isFinite(n)) near.push(n)
    }
    return near.length ? near.reduce((sum, n) => sum + n, 0) / near.length : v
  })
}

/**
 * How many samples of a probe's own series make up seven minutes of neighbours,
 * forced odd so the filter has a centre sample.
 */
export function despikeWindow(points: { ts: number }[]): number {
  let step = Infinity
  for (let i = 1; i < points.length; i++) step = Math.min(step, points[i].ts - points[i - 1].ts)
  if (!Number.isFinite(step) || step <= 0) return 3
  return Math.min(15, Math.max(3, Math.round(420 / step) | 1))
}
