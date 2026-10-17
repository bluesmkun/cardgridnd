import { useCallback, useEffect, useMemo, useState } from "react"
import { groupsOf, useNodes, type Node } from "@/lib/api"
import { NodeCard } from "@/components/NodeCard"
import { Summary } from "@/components/Summary"
import { NodeDetail } from "@/components/NodeDetail"
import { Settings } from "@/components/Settings"
import { markdown } from "@/lib/markdown"
import { useFlag, useTheme } from "@/lib/theme"
import { useNotice } from "@/lib/style"

/**
 * Which group the grid is showing.
 *
 * `null` is the whole fleet, and it is deliberately not a string: the hub lets
 * an operator name a group anything at all, up to thirteen characters, and some
 * of them will pick `*`, `all`, `none`, 「全部」 or 「未分组」. Choosing the group
 * by a name equal to the sentinel would make that one group unreachable, so the
 * sentinel lives outside the space of names.
 */
type Selected = string | null

/** The node's group as the tab strip needs it, where "" means ungrouped. */
const UNGROUPED = ""

function groupOf(node: Node): string {
  return node.group ?? ""
}

export function App() {
  const { nodes, error, closed } = useNodes()
  const notice = useNotice()
  const { canSave } = useTheme()
  const showSummary = useFlag("show_summary", true)
  const showGroups = useFlag("show_groups", true)

  const [selected, setSelected] = useState<Selected>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [settings, setSettings] = useState(false)

  // The route, read from the path rather than a router: the hub serves this one
  // entry point for `/` and for every `/node/{id}`, and hands anything it owns
  // (`/admin`, `/api`, `/install.sh`, `/agent/*`) to its own handler before the
  // theme is reached. A twenty-line hash-free parser is less than react-router,
  // which this theme does not otherwise need.
  useEffect(() => {
    const read = () => {
      const match = /^\/node\/(\d+)\/?$/.exec(location.pathname)
      setOpenId(match ? Number(match[1]) : null)
    }
    read()
    addEventListener("popstate", read)
    return () => removeEventListener("popstate", read)
  }, [])

  const open = useCallback((id: number) => {
    history.pushState(null, "", `/node/${id}`)
    setOpenId(id)
  }, [])

  const back = useCallback(() => {
    history.pushState(null, "", "/")
    setOpenId(null)
  }, [])

  // Groups in the order the nodes are in, which is the order the operator put
  // them in: sorting by name would reorder the tabs the moment a group is
  // renamed. Nodes with no group are kept, not dropped -- with even one group in
  // play they still need somewhere to go.
  const tabs = useMemo(() => {
    if (!nodes) return []
    const named = groupsOf(nodes)
    if (named.length === 0) return []
    const ungrouped = nodes.some((n) => groupOf(n) === UNGROUPED)
    return ungrouped ? [...named, UNGROUPED] : named
  }, [nodes])

  // A group can disappear between two pushes, when the operator moves its last
  // node into another one. Rather than leave the grid empty under a tab that no
  // longer exists, this falls back to the whole fleet.
  const active = selected !== null && tabs.includes(selected) ? selected : null

  const shown = useMemo(() => {
    if (!nodes) return null
    if (active === null) return nodes
    return nodes.filter((node) => groupOf(node) === active)
  }, [nodes, active])

  const label = (group: string) => (group === UNGROUPED ? "未分组" : group)

  if (openId !== null) {
    return (
      <>
        <Masthead canSave={canSave} onSettings={() => setSettings(true)} />
        <NodeDetail id={openId} onBack={back} />
        <Settings open={settings} onClose={() => setSettings(false)} />
      </>
    )
  }

  return (
    <>
      <Masthead canSave={canSave} onSettings={() => setSettings(true)} />

      {notice && <div className="notice">{markdown(notice)}</div>}

      <main className="shell">
        {error && (
          <div className="banner" data-tone="bad">
            {error}
          </div>
        )}

        {closed && !error && (
          <div className="banner">这个状态页没有公开，登录后才能查看。</div>
        )}

        {/* The summary is handed the filtered array, not the whole fleet: with a
            group selected every figure above the grid describes that group.
            Half a page following the tab and half the site would be worse than
            either. */}
        {shown && showSummary && shown.length > 0 && <Summary nodes={shown} />}

        {tabs.length > 1 && showGroups && (
          <div className="tabs">
            <button
              type="button"
              className="tab"
              data-on={active === null ? "true" : undefined}
              onClick={() => setSelected(null)}
            >
              全部
            </button>
            {tabs.map((group) => (
              <button
                key={group}
                type="button"
                className="tab"
                data-on={active === group ? "true" : undefined}
                onClick={() => setSelected(group)}
              >
                {label(group)}
              </button>
            ))}
          </div>
        )}

        {!shown && !error && (
          <div className="grid">
            {/* Four placeholders: one screenful of the two-column grid. */}
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton skeleton-card" />
            ))}
          </div>
        )}

        {shown && shown.length === 0 && (
          <div className="empty">{nodes && nodes.length > 0 ? "这个分组里还没有节点。" : "还没有节点接入。"}</div>
        )}

        {shown && shown.length > 0 && (
          <div className="grid">
            {shown.map((node) => (
              <NodeCard key={node.id} node={node} onOpen={open} />
            ))}
          </div>
        )}
      </main>

      <Settings open={settings} onClose={() => setSettings(false)} />
    </>
  )
}

function Masthead({ canSave, onSettings }: { canSave: boolean; onSettings: () => void }) {
  const { me } = useTheme()
  return (
    <header className="masthead">
      <div className="brand">
        <span className="mark" aria-hidden="true" />
        <span className="name">{me?.site_name || "状态"}</span>
      </div>
      <div className="head-tools">
        {canSave && (
          <>
            <button type="button" className="btn" onClick={onSettings}>
              设置
            </button>
            {/* A plain link, not a fetch: the hub owns `/admin`, and the theme
                only knows the path it is served from. It is shown to signed-in
                visitors because it is the operator's own way back to the panel
                that installed this theme -- the hub checks the session again on
                the other side, so a public visitor who guesses the URL gets the
                hub's own login page rather than anything of the operator's. */}
            <a className="btn" href="/admin" rel="noreferrer">
              后台
            </a>
          </>
        )}
      </div>
    </header>
  )
}
