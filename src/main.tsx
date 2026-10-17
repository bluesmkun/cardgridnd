import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "@/App"
import { ThemeProvider } from "@/lib/theme"
import "@/index.css"

// The settings have to be in place before the first paint, and they are fetched
// in parallel with the node list rather than ahead of it: `ThemeProvider` starts
// both requests in its own effect, and the page renders with defaults until they
// land. Rendering an empty shell first would show the reader a white flash of
// the wrong accent on every load.
const host = document.getElementById("root")
if (!host) throw new Error("#root is missing from index.html")

createRoot(host).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
