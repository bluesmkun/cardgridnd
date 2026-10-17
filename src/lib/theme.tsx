import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { api, type Me } from "@/lib/api"
import { clampNumber, loadConfig, resolve, saveConfig } from "@/lib/config"

interface ThemeValue {
  /** Every setting, defaults merged under whatever is stored. */
  values: Record<string, unknown>
  me: Me | null
  /** Whether a save would be accepted: the hub refuses anonymous writes. */
  canSave: boolean
  save: (values: Record<string, unknown>) => Promise<void>
  /** Applies settings to the page without storing them, for the settings form. */
  preview: (values: Record<string, unknown>) => void
  revert: () => void
}

const Context = createContext<ThemeValue | null>(null)

/**
 * The two settings that change how the page is drawn, published on the root.
 *
 * Written in a layout effect so they are in place before the browser paints:
 * otherwise a station that has switched the hairlines off draws one frame with
 * them on. Published by presence rather than by value, because the stylesheet
 * asks whether the attribute is there at all -- `data-hairline="false"` would
 * read as true to a selector like `[data-hairline]`.
 */
function publish(values: Record<string, unknown>) {
  const root = document.documentElement
  if (values.hairline === true) root.dataset.hairline = "true"
  else delete root.dataset.hairline
  if (values.hover_lift === true) root.dataset.lift = "true"
  else delete root.dataset.lift
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Record<string, unknown>>(() => resolve({}))
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    let alive = true
    loadConfig().then((values) => {
      if (alive) setStored(values)
    })
    api<Me>("/me")
      .then((value) => {
        if (alive) setMe(value)
      })
      // The panel is the only place settings are edited, and it needs a login;
      // an unauthenticated reader simply never sees the button.
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const values = useMemo(() => draft ?? stored, [draft, stored])

  useLayoutEffect(() => publish(values), [values])

  const save = useCallback(async (next: Record<string, unknown>) => {
    await saveConfig(next)
    setStored(resolve(next))
    setDraft(null)
  }, [])

  const value = useMemo<ThemeValue>(
    () => ({
      values,
      me,
      canSave: me?.authed === true,
      save,
      preview: setDraft,
      revert: () => setDraft(null),
    }),
    [values, me, save],
  )

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useTheme(): ThemeValue {
  const value = useContext(Context)
  if (!value) throw new Error("useTheme must be used inside ThemeProvider")
  return value
}

export function useFlag(key: string, fallback = false): boolean {
  const value = useTheme().values[key]
  return typeof value === "boolean" ? value : fallback
}

export function useText(key: string, fallback = ""): string {
  const value = useTheme().values[key]
  return typeof value === "string" ? value : fallback
}

export function useNumber(key: string, fallback: number): number {
  const value = useTheme().values[key]
  return typeof value === "number" && Number.isFinite(value) ? clampNumber(key, value) : fallback
}
