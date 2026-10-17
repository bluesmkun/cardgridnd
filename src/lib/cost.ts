import { useText, useFlag } from "@/lib/theme"
import { DEFAULT_RATE_URL, rate, useRates, type Rates } from "@/lib/rates"

/**
 * The exchange rates the cost tile needs, read through this theme's own
 * settings.
 *
 * The store -- six-hour cache, the two response shapes, the localStorage copy --
 * is in `@/lib/rates`; what lives here is the one decision this theme makes
 * about it: the tile is only told to fetch when the operator both shows prices
 * and has picked a display currency. With 原币种 selected there is nothing to
 * convert and no reason to tell a third party the page was opened.
 */
export { DEFAULT_RATE_URL, rate, type Rates }

export function useCostRates(): Rates | null {
  const currency = useText("currency", "")
  const showPrice = useFlag("show_price", true)
  const url = useText("rate_url", "") || DEFAULT_RATE_URL
  return useRates(url, currency !== "" && showPrice)
}
