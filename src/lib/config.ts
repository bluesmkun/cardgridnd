/**
 * The theme's settings: what it declares, and how it reads them back.
 *
 * The declarations live in `theme.json`, where the hub uses them to draw the
 * panel's form, and they are imported here rather than written out a second
 * time: two copies of a schema drift, and the one the panel shows is the one
 * that is authoritative. The page still needs them locally for two reasons --
 * the defaults, to render correctly before the station owner has changed
 * anything, and each field's type, to avoid trusting whatever comes back over
 * the network.
 *
 * `resolveJsonModule` is on, so the import is a plain object typed from the
 * file. `manifest.config` is narrowed to `Declared[]` by hand because JSON
 * imports widen `type` to `string`.
 */

import manifest from "../../theme.json"

export type FieldType = "string" | "text" | "number" | "boolean" | "select"

export interface Option {
  value: string
  label: string
}

export interface Field {
  key: string
  type: FieldType
  default: unknown
  label?: string
  help?: string
  min?: number
  max?: number
  options?: Option[]
}

/** A group heading in the panel's form; carries no value of its own. */
export interface Title {
  type: "title"
  label: string
}

export type Declared = Field | Title

/**
 * The declarations as `theme.json` writes them.
 *
 * The panel drops a malformed entry and keeps the rest, so a theme that has one
 * is not obviously broken from the outside; that makes it worth keeping the two
 * readers of this array -- the panel and `fields` below -- on the same shape.
 */
export const declared = (manifest.config ?? []) as Declared[]

/** Just the fields, for anything iterating values rather than drawing the form. */
export const fields: Field[] = declared.filter((entry): entry is Field => entry.type !== "title")

const byKey = new Map(fields.map((field) => [field.key, field]))

/**
 * Saved settings merged over the defaults, with every value forced to the type
 * its field declares. A value of the wrong type is discarded rather than
 * rendered: the settings endpoint is public, and a hand-edited one should not be
 * able to put an object where the page expects a number.
 */
export function resolve(saved: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const value = Object.prototype.hasOwnProperty.call(saved, field.key) ? saved[field.key] : undefined
    out[field.key] = valid(field, value) ? value : field.default
  }
  return out
}

function valid(field: Field, value: unknown): boolean {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean"
    case "number":
      // The range is part of the declaration, not only a hint for the form: a
      // value saved by an older version of this theme, or edited in the panel
      // before a range was tightened, has to be as unacceptable as one out of a
      // text box. Without the bounds a stale `columns: 99` would be honoured.
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= (field.min ?? -Infinity) &&
        value <= (field.max ?? Infinity)
      )
    case "select":
      // An option list is authoritative where there is one; a free select (the
      // currency) accepts any string, since the set of currencies is open.
      return typeof value === "string" && (!field.options || field.options.some((o) => o.value === value))
    default:
      return typeof value === "string"
  }
}

/** A number field's value, clamped to the range its declaration gives it. */
export function clampNumber(key: string, value: number): number {
  const field = byKey.get(key)
  if (!field) return value
  let out = value
  if (typeof field.min === "number") out = Math.max(field.min, out)
  if (typeof field.max === "number") out = Math.min(field.max, out)
  return out
}

const SHORT = "cardgridnd"

/**
 * Reads the station's settings. Failure is not an error the reader should ever
 * see -- a hub too old to have the endpoint, or a network that is down, both
 * mean the same thing here: render the defaults.
 */
export async function loadConfig(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`/api/themes/${SHORT}/config`, { credentials: "same-origin" })
    if (!res.ok) return resolve({})
    const saved = (await res.json()) as Record<string, unknown>
    return resolve(saved && typeof saved === "object" ? saved : {})
  } catch {
    return resolve({})
  }
}

/**
 * Writes settings back.
 *
 * Reads the stored object first rather than sending the merged view: the hub
 * keeps only what differs from the defaults, and a key sent with its default
 * value would be stored forever, so a later change of that default would never
 * reach a station that had once saved the old one.
 */
export async function saveConfig(values: Record<string, unknown>): Promise<void> {
  const url = `/api/themes/${SHORT}/config`
  let stored: Record<string, unknown> = {}
  try {
    const res = await fetch(url, { credentials: "same-origin" })
    if (res.ok) {
      const parsed = (await res.json()) as unknown
      if (parsed && typeof parsed === "object") stored = parsed as Record<string, unknown>
    }
  } catch {
    // Treat an unreadable store as empty: the PUT below is authoritative.
  }

  const next: Record<string, unknown> = { ...stored }
  for (const field of fields) {
    if (values[field.key] === field.default) delete next[field.key]
    else next[field.key] = values[field.key]
  }

  const res = await fetch(url, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next),
  })
  if (!res.ok) throw new Error((await res.text()).trim() || `保存失败（HTTP ${res.status}）`)
}
