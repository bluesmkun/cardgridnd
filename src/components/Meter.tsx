/**
 * A thin utilisation bar: a hairline label column, a 6px track, a filled track
 * and the figure.
 *
 * The bar is one solid colour on one grey track and nothing else -- no glow, no
 * segments, no gradient. On a white page the only thing that has to be readable
 * at a glance is how full it is, and a bar that changes colour with its own
 * length (green, then amber, then red) would say that twice while making two
 * cards of the same fullness look different, which is exactly what a column of
 * cards is scanned for.
 *
 * `value: null` is the empty meter: the track stays, unfilled, and the figure is
 * an em dash. A card for a node that is down keeps its whole row of meters this
 * way, so it is the same height as its neighbours and the columns still line up
 * down the page -- a missing figure shown as a missing figure, rather than as a
 * shorter card.
 *
 * `tone` is the one exception, and it is opt-in: a plan used past its quota is
 * not merely full but over, and that is a different fact from 92% full.
 */
export function Meter({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  /** 0-100 or higher; a plan used past its quota reads over 100. `null` = no data. */
  value: number | null
  detail: string
  /** Overrides the neutral fill, for a figure whose danger is not its magnitude. */
  tone?: "warn" | "bad"
}) {
  const empty = value === null || !Number.isFinite(value)

  if (empty) {
    return (
      <div className="meter" data-empty="true">
        <span className="label">{label}</span>
        <div className="track" />
        <span className="val">—</span>
      </div>
    )
  }

  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className="meter">
      <span className="label">{label}</span>
      <div className="track">
        <div className="fill" style={{ width: `${clamped}%` }} data-tone={tone} />
      </div>
      <span className="val">{detail}</span>
    </div>
  )
}
