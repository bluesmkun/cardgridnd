// Assembles the installable theme directory the hub expects:
//
//   y2k/
//   ├── theme.json
//   ├── preview.png      (optional, but the panel's card looks broken without it)
//   └── dist/            (Vite's output; index.html plus hashed assets)
//
// Vite writes dist/ directly (see `build.outDir` in vite.config.ts), so this only
// has to place the two files beside it. It runs after `vite build` and before
// `pack.mjs`.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const manifest = JSON.parse(readFileSync(join(ROOT, "theme.json"), "utf8"))
const out = join(ROOT, manifest.short)

// `short` names the directory, so it is also a path segment: the hub refuses to
// install a theme whose short is anything but letters, digits, - and _, but a
// stray separator here would still write outside the theme before that check.
if (!/^[A-Za-z0-9_-]+$/.test(manifest.short)) {
  throw new Error(`theme.json short must be letters, digits, - or _; got ${JSON.stringify(manifest.short)}`)
}

// Every field the hub requires at install time, checked here so a malformed
// theme.json fails the build rather than the upload.
for (const key of ["name", "short", "description", "version", "author", "url"]) {
  if (typeof manifest[key] !== "string") throw new Error(`theme.json is missing the string field ${key}`)
}

if (!existsSync(join(ROOT, manifest.short, "dist", "index.html"))) {
  throw new Error("dist/index.html is missing; run vite build first")
}

mkdirSync(out, { recursive: true })
copyFileSync(join(ROOT, "theme.json"), join(out, "theme.json"))
if (existsSync(join(ROOT, "preview.png"))) {
  copyFileSync(join(ROOT, "preview.png"), join(out, "preview.png"))
}
console.log(`assembled ${manifest.short}/ for ${manifest.name} ${manifest.version}`)
