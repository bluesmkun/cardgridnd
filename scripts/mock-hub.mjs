// A stand-in for the monitor hub, for eyeballing the theme during development.
// It answers exactly the endpoints src/lib/api.ts calls, with figures shaped
// like a real report, so the page can be built and looked at without a fleet.
//
//   node scripts/mock-hub.mjs [port]
//
// Not part of the theme and never packaged: it lives in scripts/ and only the
// built paper/dist is shipped. The WebSocket pushes one frame on connect and
// then every two seconds, the way the hub does.
import { createServer } from "node:http"
import { randomUUID } from "node:crypto"

const port = Number(process.argv[2] || 9911)

const GiB = 1024 ** 3
const MiB = 1024 ** 2

/** A deterministic wobble, so successive frames move but a screenshot is stable. */
const wave = (t, period, lo, hi) => lo + (hi - lo) * (0.5 + 0.5 * Math.sin((t / period) * Math.PI * 2))

const FLEET = [
  { id: 1, name: "hk-edge-01", group: "香港", country: "HK", os: "debian", virt: "kvm", cores: 4, mem: 8, disk: 80, price: 12, currency: "USD", cycle: "monthly", expires: 21, tx: 2.0, limit: 1000, mode: "sum" },
  { id: 2, name: "hk-edge-02", group: "香港", country: "HK", os: "debian", virt: "kvm", cores: 2, mem: 4, disk: 40, price: 6, currency: "USD", cycle: "monthly", expires: 4, tx: 0.4, limit: 500, mode: "sum" },
  { id: 3, name: "jp-relay-01", group: "日本", country: "JP", os: "ubuntu", virt: "kvm", cores: 8, mem: 16, disk: 160, price: 24, currency: "USD", cycle: "monthly", expires: 96, tx: 3.1, limit: 2000, mode: "max" },
  { id: 4, name: "sg-core-01", group: "新加坡", country: "SG", os: "debian", virt: "lxc", cores: 4, mem: 8, disk: 100, price: 180, currency: "CNY", cycle: "yearly", expires: 210, tx: 1.2, limit: 3000, mode: "sum" },
  { id: 5, name: "us-west-01", group: "美国", country: "US", os: "ubuntu", virt: "kvm", cores: 2, mem: 4, disk: 50, price: 9, currency: "USD", cycle: "monthly", expires: 61, tx: 0.8, limit: 1000, mode: "down" },
  { id: 6, name: "fi-backup-01", group: "欧洲", country: "FI", os: "alpine", virt: "kvm", cores: 1, mem: 2, disk: 20, price: 0, currency: "", cycle: "", expires: null, tx: 0.05, limit: 0, mode: "" },
  // 一台免费机放在 日本 组：那一组整体没有费用，用来验证费用格不消失。
  { id: 7, name: "jp-free-01", group: "日本", country: "JP", os: "debian", virt: "lxc", cores: 1, mem: 1, disk: 10, price: 0, currency: "", cycle: "", expires: null, tx: 0.02, limit: 0, mode: "" },
]

const DAY = 86400
const now = () => Math.floor(Date.now() / 1000)

function metricsFor(spec, t, hours, points) {
  const step = Math.max(60, Math.floor((hours * 3600) / points))
  const rows = []
  for (let ts = t - hours * 3600; ts <= t; ts += step) {
    // A deterministic shape per node, plus a daily cycle, so the charts have
    // something with structure in them rather than white noise.
    const dayCycle = 0.5 + 0.5 * Math.sin((ts / DAY) * Math.PI * 2)
    const cpu = Math.max(0.3, wave(ts, 900, 3, 26) * (0.4 + dayCycle) + spec.id * 1.1)
    const mem = spec.mem * GiB * (0.34 + 0.16 * dayCycle + spec.id * 0.012)
    const disk = spec.disk * GiB * (0.41 + spec.id * 0.018)
    const rx = Math.max(1024, wave(ts, 700, 0.35, 9.2) * MiB * (1 + dayCycle))
    const tx = Math.max(1024, wave(ts, 610, 0.18, 3.4) * MiB * (1 + dayCycle * 0.6))
    rows.push({
      ts,
      cpu: Number(cpu.toFixed(2)),
      cpu_max: Number((cpu * 1.6).toFixed(2)),
      mem_used: Math.round(mem),
      disk_used: Math.round(disk),
      net_rx: Math.round(rx),
      net_tx: Math.round(tx),
      net_rx_max: Math.round(rx * 1.7),
      net_tx_max: Math.round(tx * 1.7),
      minutes: step / 60,
    })
  }
  return { rows, step }
}

function node(spec, t) {
  // Node 6 is deliberately offline, node 2 has just come up and not reported,
  // and node 5 reports a figure the theme has to reject, so all four card
  // states are on screen at once.
  if (spec.id === 6) {
    return {
      ...base(spec, t), online: false, metrics: null,
    }
  }
  if (spec.id === 2) {
    return { ...base(spec, t), online: true, metrics: null, last_seen: t - 40, last_seen_ago: 40 }
  }
  if (spec.id === 5) {
    return { ...base(spec, t), online: true, metrics: { ...plainMetrics(spec, t), cpu: Number.NaN } }
  }
  return { ...base(spec, t), online: true, metrics: plainMetrics(spec, t) }
}

function base(spec, t) {
  const monthly = spec.tx * 1024 ** 4
  return {
    id: spec.id, name: spec.name, sort: spec.id, public: true, country: spec.country,
    group: spec.group, last_seen: t - 2, last_seen_ago: 2,
    os: spec.os, kernel: "6.1.0-18-amd64", arch: "x86_64", virt: spec.virt,
    cpu_name: "AMD EPYC 7B13", cpu_cores: spec.cores,
    mem_total: spec.mem * GiB, swap_total: GiB, disk_total: spec.disk * GiB,
    agent_version: "1.4.0", price: spec.price, currency: spec.currency, billing_cycle: spec.cycle,
    expires_at: spec.expires === null ? null : new Date((t + spec.expires * DAY) * 1000).toISOString().slice(0, 10),
    expires_in: spec.expires,
    traffic_limit: spec.limit * 1024 ** 3, traffic_mode: spec.mode, traffic_reset_day: 1,
    total_rx: monthly * 7, total_tx: monthly * 5, month_rx: monthly * 0.72, month_tx: monthly * 0.28,
    month_used: monthly, month_start: new Date(t * 1000).toISOString().slice(0, 8) + "01",
    day_rx: monthly * 0.031, day_tx: monthly * 0.012,
    public_remark: spec.id === 1 ? "主力中转，晚高峰略慢" : spec.id === 3 ? "按流量计费，**注意** 别跑满" : "",
  }
}

function plainMetrics(spec, t) {
  const { rows } = metricsFor(spec, t, 1, 2)
  const last = rows[rows.length - 1]
  return {
    uptime: 3_600 * 24 * (11 + spec.id), cpu: last.cpu, load: [0.42 + spec.id * 0.1, 0.31, 0.22],
    mem_total: spec.mem * GiB, mem_used: last.mem_used, swap_total: GiB, swap_used: 4096,
    disk_total: spec.disk * GiB, disk_used: last.disk_used,
    net_rx: last.net_rx, net_tx: last.net_tx,
    total_rx: spec.tx * 1024 ** 4 * 7, total_tx: spec.tx * 1024 ** 4 * 5,
    month_rx: spec.tx * 1024 ** 4 * 0.72, month_tx: spec.tx * 1024 ** 4 * 0.28,
    tcp: 120 + spec.id * 9, udp: 14 + spec.id, procs: 180 + spec.id * 7,
  }
}

const PROBES = { 1: "电信 上海", 2: "联通 北京", 3: "移动 广州" }

function answer(id, hours, points, series, t) {
  const spec = FLEET.find((s) => s.id === id)
  if (!spec) return null
  const { rows, step } = metricsFor(spec, t, hours, points)
  const out = { metrics: [], ping: [], probes: {}, step }
  if (series !== "ping") out.metrics = rows
  if (series !== "metrics") {
    const probeStep = Math.max(step, 60)
    for (const [task, name] of Object.entries(PROBES)) {
      out.probes[task] = name
      // A per-probe baseline and jitter, so three carriers are visibly different
      // lines rather than three copies of one.
      const base = 18 + Number(task) * 34
      for (let ts = t - hours * 3600; ts <= t; ts += probeStep) {
        const spike = spec.id === 4 && Number(task) === 2 && (ts % 3600) < probeStep
        // The drift has to be slow against the sample spacing, or it aliases.
        //
        // `wave` was called with a period of a few hundred seconds while the
        // seven-day tier samples every 840s: thirteen samples landed per cycle,
        // and a sine read at a fixed fraction of its own period is not a sine,
        // it is a repeating sawtooth. The chart was faithfully drawing a
        // thirteen-value loop sixty times over, which is what made the line look
        // like noise. A period of a few hours is what a carrier's ordinary drift
        // looks like anyway.
        const drift = wave(ts, 5 * 3600 + Number(task) * 3600, -1, 1)
        // Ordinary jitter: small, independent per sample, and unsmoothed -- this
        // is the chatter the chart's own 平滑 switch exists to take out.
        const jitter = (Math.random() - 0.5) * 0.22
        // The mobile probe is the lossy one; one in forty samples times out.
        const timeout = Number(task) === 3 && Math.abs(Math.sin(ts / 400)) > 0.975
        // A latency is a duration, so it is never negative, and it is clamped
        // well clear of zero rather than at it: a probe that returns 1ms is
        // indistinguishable from one that failed. The floor is a fifth of the
        // baseline, which keeps the fast probe's own readings ordered.
        const ms = Math.max(base * 0.2, base * (1 + drift * 0.16 + jitter) + (spike ? 260 : 0))
        out.ping.push({
          task_id: Number(task), ts,
          latency: timeout ? null : Number(ms.toFixed(2)),
        })
      }
    }
    out.loss = { 1: 0, 2: spec.id === 4 ? 1.8 : 0, 3: 2.4 }
  }
  return out
}

const config = {}

const json = (res, body) => {
  const text = JSON.stringify(body)
  res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(text) })
  res.end(text)
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost")
  const t = now()
  const p = url.pathname

  if (p === "/api/me") return json(res, { authed: true, github: true, site_name: "白纸 · 演示", public_page: true, history_days: 7 })
  if (p === "/api/nodes") return json(res, { nodes: FLEET.map((s) => node(s, t)) })

  const metrics = /^\/api\/nodes\/(\d+)\/metrics$/.exec(p)
  if (metrics) {
    const body = answer(Number(metrics[1]), Number(url.searchParams.get("hours") || 6), Number(url.searchParams.get("points") || 240), url.searchParams.get("series") || "metrics", t)
    if (!body) {
      res.writeHead(404, { "content-type": "text/plain" })
      return res.end("没有这台主机")
    }
    return json(res, body)
  }

  const theme = /^\/api\/themes\/([^/]+)\/config$/.exec(p)
  if (theme) {
    if (req.method === "PUT") {
      let raw = ""
      req.on("data", (c) => (raw += c))
      req.on("end", () => {
        try { Object.assign(config, JSON.parse(raw)) } catch {}
        res.writeHead(204)
        res.end()
      })
      return
    }
    return json(res, config)
  }

  res.writeHead(404, { "content-type": "text/plain" })
  res.end("not found")
})

// The live stream. One frame immediately, then every two seconds, so a page
// that opens gets its fleet without waiting.
server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"]
  if (!key) return socket.destroy()
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`)

  const send = () => {
    const text = Buffer.from(JSON.stringify({ nodes: FLEET.map((s) => node(s, now())) }))
    const head = text.length < 126 ? Buffer.from([0x81, text.length]) : Buffer.concat([Buffer.from([0x81, 126]), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(text.length); return b })()])
    try { socket.write(Buffer.concat([head, text])) } catch {}
  }
  send()
  const timer = setInterval(send, 2000)
  socket.on("close", () => clearInterval(timer))
  socket.on("error", () => clearInterval(timer))
})

import { createHash } from "node:crypto"
server.listen(port, "127.0.0.1", () => console.log(`mock hub on http://127.0.0.1:${port}/`))
