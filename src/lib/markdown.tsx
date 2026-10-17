/**
 * A deliberately tiny Markdown subset for the operator's notice line: bold,
 * italic, inline code and links.
 *
 * The rule the theme document sets is that a setting value never reaches
 * `innerHTML`, so this does not produce HTML at all. It returns React nodes, and
 * every piece of the operator's text becomes a text child, which React escapes.
 * A link is only kept when its scheme is one of `http:`, `https:` or `mailto:` --
 * a `javascript:` URL here would be an XSS reachable from the settings page.
 */

const SAFE = /^(https?:|mailto:)/i

type Part = { text: string; kind: "text" | "b" | "i" | "code"; href?: string }

// One pass over the line, longest delimiters first so `**` is not read as two `*`.
const TOKEN = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`|\[([^\]]*)\]\(([^)\s]+)\)/g

function parse(line: string): Part[] {
  const parts: Part[] = []
  let at = 0
  for (let m = TOKEN.exec(line); m; m = TOKEN.exec(line)) {
    if (m.index > at) parts.push({ text: line.slice(at, m.index), kind: "text" })
    if (m[1] ?? m[2]) parts.push({ text: m[1] ?? m[2], kind: "b" })
    else if (m[3] ?? m[4]) parts.push({ text: m[3] ?? m[4], kind: "i" })
    else if (m[5] !== undefined) parts.push({ text: m[5], kind: "code" })
    else {
      // An unsafe scheme is dropped rather than turned into a link: the text is
      // still the operator's, so it stays readable.
      const href = m[7]
      parts.push(SAFE.test(href) ? { text: m[6] || href, kind: "text", href } : { text: m[6], kind: "text" })
    }
    at = m.index + m[0].length
  }
  if (at < line.length) parts.push({ text: line.slice(at), kind: "text" })
  return parts
}

export function markdown(source: string): React.ReactNode[] {
  return source.split("\n").map((line, i) => {
    const parts = parse(line)
    return (
      <span key={i}>
        {i > 0 && <br />}
        {parts.map((part, j) => {
          if (part.href) {
            return (
              <a key={j} href={part.href} target="_blank" rel="noreferrer noopener">
                {part.text}
              </a>
            )
          }
          if (part.kind === "b") return <strong key={j}>{part.text}</strong>
          if (part.kind === "i") return <em key={j}>{part.text}</em>
          if (part.kind === "code") return <code key={j}>{part.text}</code>
          return <span key={j}>{part.text}</span>
        })}
      </span>
    )
  })
}
