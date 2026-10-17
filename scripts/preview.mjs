// Regenerates preview.png from the running preview server. Fixed 960x600 at 2x
// so the panel's card shows a crisp image, then downsampled to 960x600 RGB
// (no alpha) to match the shape the previous preview had.
import { spawn } from "node:child_process"
import { writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

const EDGE = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
const url = process.argv[2] || "http://127.0.0.1:4321/"
const out = process.argv[3] || new URL("../preview.png", import.meta.url).pathname
// The panel's card wants 960x600; a taller window is for looking at a whole page
// during development, and the scale below keeps the output that same size.
const W = Number(process.env.PREVIEW_W || 1200)
const H = Number(process.env.PREVIEW_H || 750)
const profile = mkdtempSync(join(tmpdir(), "y2k-prev-"))
const port = 9900 + Math.floor(Math.random() * 90)

const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  // Edge's own sandbox and GPU process cannot start under a restrictive outer
  // sandbox (they are denied the syscalls, and a failed GPU process is fatal).
  // Software rendering is what a preview needs anyway: it is one static PNG.
  "--no-sandbox", "--disable-gpu-sandbox", "--disable-software-rasterizer",
  "--use-angle=swiftshader", "--disable-crash-reporter",
  `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
  `--remote-debugging-port=${port}`, "about:blank",
], { stdio: "ignore" })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function target() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const p = list.find((t) => t.type === "page")
      if (p) return p
    } catch {}
    await sleep(250)
  }
  throw new Error("no target")
}

const page = await target()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
}
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id
    pending.set(n, { resolve, reject })
    ws.send(JSON.stringify({ id: n, method, params }))
  })

await call("Page.enable")
await call("Emulation.setDeviceMetricsOverride", {
  width: W, height: H, deviceScaleFactor: 2, mobile: false,
})
await call("Page.navigate", { url })
await sleep(4500)

const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })
const raw = join(tmpdir(), "y2k-prev-raw.png")
writeFileSync(raw, Buffer.from(shot.data, "base64"))

// The screenshot is 2x (2400x1500); the panel wants roughly 960x600. Use the
// bundled Python rather than a shell tool so this works on the same runtimes as
// the rest of the build.
const PY = "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/python/bin/python3"
execFileSync(PY, ["-c", `
from PIL import Image
im = Image.open(${JSON.stringify(raw)}).convert("RGB")
im = im.resize((960, 600), Image.LANCZOS) if __import__("os").environ.get("PREVIEW_KEEP") != "1" else im
im.save(${JSON.stringify(out)}, "PNG", optimize=True)
print("saved", ${JSON.stringify(out)}, im.size)
`], { stdio: "inherit" })

ws.close()
edge.kill("SIGKILL")
rmSync(profile, { recursive: true, force: true })
process.exit(0)
