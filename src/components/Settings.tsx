import { useEffect, useState } from "react"
import { declared, clampNumber, type Field } from "@/lib/config"
import { useTheme } from "@/lib/theme"

/**
 * The settings drawer.
 *
 * The hub's own panel edits these too, and that is the place an operator will
 * normally use -- this exists for the moment the operator is looking at the
 * page and wants to see what four columns would do, or what the serif face
 * looks like on their own node names. It is only offered to a signed-in
 * visitor, because the hub refuses anonymous writes and a form that cannot
 * save is worse than no form.
 *
 * Edits are applied to the page as they are made (`preview`) and only stored
 * on save, so the grid behind the sheet is the preview. Closing without saving
 * puts back whatever was stored.
 */

/** One labelled control: the text on the left, the input on the right. */
function Row({ field, value, onChange }: { field: Field; value: unknown; onChange: (next: unknown) => void }) {
  const label = field.label || field.key

  return (
    <div className="field">
      <div className="txt">
        <div className="label">{label}</div>
        {field.help && <div className="hint">{field.help}</div>}

        {field.type === "string" && (
          <input
            type="text"
            value={String(value ?? "")}
            placeholder={typeof field.default === "string" ? field.default : ""}
            onChange={(e) => onChange(e.target.value)}
          />
        )}

        {field.type === "text" && (
          <textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
        )}

        {field.type === "number" && (
          <input
            type="number"
            value={String(value ?? "")}
            min={field.min}
            max={field.max}
            onChange={(e) => {
              const n = Number(e.target.value)
              onChange(Number.isFinite(n) ? clampNumber(field.key, n) : field.default)
            }}
          />
        )}

        {field.type === "select" && (
          <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {field.type === "boolean" && (
        <label className="switch" title={label}>
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span className="box" />
        </label>
      )}
    </div>
  )
}

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { values, canSave, save, preview, revert } = useTheme()
  const [draft, setDraft] = useState<Record<string, unknown>>(values)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  // Start from what is stored each time the drawer is opened, so a discarded
  // edit is not still sitting in the form the next time it is asked for.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded on open only
  useEffect(() => {
    if (open) {
      setDraft(values)
      setError("")
    }
  }, [open])

  // Escape closes, the way every other sheet on the web does.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  const change = (key: string, next: unknown) => {
    const values = { ...draft, [key]: next }
    setDraft(values)
    preview(values)
  }

  const close = () => {
    revert()
    onClose()
  }

  const submit = async () => {
    setBusy(true)
    setError("")
    try {
      await save(draft)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，稍后再试")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label="主题设置" onMouseDown={close}>
      <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="title">设置</span>
          {!canSave && <span className="hint">只读</span>}
          <button type="button" className="close" onClick={close} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="sheet-body">
          {declared.map((entry, i) => {
            if (entry.type === "title") {
              return (
                <div className="group" key={`t${i}`}>
                  {entry.label}
                </div>
              )
            }
            return <Row key={entry.key} field={entry} value={draft[entry.key]} onChange={(next) => change(entry.key, next)} />
          })}
        </div>

        <div className="drawer-actions">
          {error ? <span className="hint">{error}</span> : <span className="grow" />}
          <button type="button" className="btn" onClick={close}>
            取消
          </button>
          <button type="button" className="btn" data-on="true" disabled={!canSave || busy} onClick={submit}>
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  )
}
