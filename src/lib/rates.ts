import { useEffect, useState } from "react"

/**
 * Exchange rates for the cost tile.
 *
 * The hub bills each node in its own currency and never converts: `price` and
 * `currency` are whatever the operator typed. A fleet-wide total therefore has to
 * be converted in the browser, which means asking somebody for the rates. The
 * endpoint is a setting, because a public status page is not the place to make an
 * unannounced third-party request: an operator who wants the figures in one
 * currency points this at open.er-api.com (the default, free, no key, CORS-open),
 * at their own mirror, or leaves the display currency on 原币种, in which case
 * nothing is fetched at all.
 *
 * Rates move once a day, so an answer is cached in memory and localStorage for
 * six hours: every card re-render and every page load would otherwise be another
 * request for a number that has not changed.
 */

/** Units of each currency per one unit of `base`, as the endpoint reports them. */
export type Rates = { base: string; rates: Record<string, number>; at: number }

export const DEFAULT_RATE_URL = "https://open.er-api.com/v6/latest/USD"

const TTL = 6 * 60 * 60 * 1000
const KEY = "paper.rates:"
const memory = new Map<string, Rates>()

const code = (currency: string): string => (currency ?? "").toUpperCase()
const isCode = (c: string) => /^[A-Z]{3}$/.test(c)

/**
 * Both shapes in the wild: `{base_code, rates}` from open.er-api.com and
 * `{base, conversion_rates}` from exchangerate-api's keyed product, so a custom
 * endpoint is more likely to work without the operator rewriting it.
 */
function parse(payload: unknown): Rates | null {
  if (!payload || typeof payload !== "object") return null
  const body = payload as Record<string, unknown>
  const table = (body.rates ?? body.conversion_rates) as Record<string, unknown> | undefined
  if (!table || typeof table !== "object") return null
  const rates: Record<string, number> = {}
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) rates[key.toUpperCase()] = value
  }
  if (!Object.keys(rates).length) return null
  const base = code(String(body.base_code ?? body.base ?? "USD"))
  return { base: isCode(base) ? base : "USD", rates, at: Date.now() }
}

function stored(url: string): Rates | null {
  const hit = memory.get(url)
  if (hit) return hit
  try {
    const raw = localStorage.getItem(KEY + url)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Rates
    if (!parsed || typeof parsed.at !== "number" || !parsed.rates) return null
    memory.set(url, parsed)
    return parsed
  } catch {
    // localStorage throws in some privacy modes; the cache is an optimisation,
    // and a page that cannot keep one still shows the figures.
    return null
  }
}

function keep(url: string, rates: Rates) {
  memory.set(url, rates)
  try {
    localStorage.setItem(KEY + url, JSON.stringify(rates))
  } catch {
    // Full or unavailable storage: the in-memory copy still serves this page.
  }
}

/**
 * Convert an amount, or null when no rate covers the pair. Null is the caller's
 * cue to show the original currency rather than a wrong number.
 */
export function rate(amount: number, from: string, to: string, rates: Rates | null): number | null {
  const a = code(from)
  const b = code(to)
  if (!isCode(a) || !isCode(b)) return null
  if (a === b) return amount
  if (!rates) return null
  // The base currency is not always listed in its own table.
  const per = rates.rates[a] ?? (a === rates.base ? 1 : undefined)
  const into = rates.rates[b] ?? (b === rates.base ? 1 : undefined)
  if (!per || !into || !Number.isFinite(per) || !Number.isFinite(into) || per <= 0) return null
  return (amount / per) * into
}

/** The current table for `url`, or null while it is unknown. */
export function useRates(url: string, enabled: boolean): Rates | null {
  const [rates, setRates] = useState<Rates | null>(() => (enabled ? stored(url) : null))

  useEffect(() => {
    if (!enabled || !url) {
      setRates(null)
      return
    }
    const hit = stored(url)
    if (hit) setRates(hit)
    if (hit && Date.now() - hit.at < TTL) return

    let live = true
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 8000)
    fetch(url, { signal: abort.signal })
      .then((reply) => (reply.ok ? reply.json() : Promise.reject(new Error(String(reply.status)))))
      .then((payload) => {
        const fresh = parse(payload)
        if (!fresh) return
        keep(url, fresh)
        if (live) setRates(fresh)
      })
      .catch(() => {
        // A page that cannot reach the rate endpoint keeps the last table it
        // saw, or falls back to the original currencies. Either is better than
        // an error banner over a status page.
      })
      .finally(() => clearTimeout(timer))
    return () => {
      live = false
      clearTimeout(timer)
      abort.abort()
    }
  }, [url, enabled])

  return rates
}
