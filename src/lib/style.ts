import { useText, useFlag } from "@/lib/theme"

/**
 * How the card is drawn, as one object read in one place.
 *
 * Every one of these is a boolean the operator can switch off, and the card
 * passes them down to its own sub-blocks; gathering them here keeps the panel's
 * schema (theme.json) in step with the component, since a `useFlag` call with a
 * key that no longer exists silently falls back to its default rather than
 * failing.
 */
export type CardStyle = {
  showPrice: boolean
  showTraffic: boolean
  showNet: boolean
  showFlags: boolean
}

export function useCardStyle(): CardStyle {
  return {
    showPrice: useFlag("show_price", true),
    showTraffic: useFlag("show_traffic", true),
    showNet: useFlag("show_net", true),
    showFlags: useFlag("show_flags", true),
  }
}

/** The free-text one, read through the same module so a card imports one thing. */
export function useNotice(): string {
  return useText("notice", "")
}
