import { execSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'

// Short git sha + local build time, shown in the Settings footer so "which
// build is this screen running" is answerable from the kitchen instead of
// over SSH. Falls back to 'dev' outside a git checkout.
function buildStamp() {
  let sha = 'dev'
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    // not a git checkout (or git missing): keep 'dev'
  }
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  return `${sha} - ${when}`
}

// Computed ONCE per build: the bundle's __BUILD_STAMP__ and the emitted
// build.json must be the same string, or every screen would see a "new" deploy
// on its first poll and reload forever.
const BUILD_STAMP = buildStamp()

// Emits dist/build.json = {"stamp": BUILD_STAMP}. Screens poll it on the hub
// (shell/useReloadOnDeploy.js) and reload when it no longer matches the
// __BUILD_STAMP__ they were built with, which is how the Echo - which nobody
// can reach with a keyboard - picks up a deploy.
function buildJson(stamp) {
  return {
    name: 'smart-display-build-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build.json',
        source: JSON.stringify({ stamp }),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), buildJson(BUILD_STAMP)],
  define: {
    __BUILD_STAMP__: JSON.stringify(BUILD_STAMP),
  },
  build: {
    // Silk on the Echo Show (Fire OS 7) is an older Chromium than the Pi's.
    // Syntax lowering costs the modern kitchen nothing; without it a single
    // `??=` would leave the Echo on a blank page. Runtime APIs are NOT
    // polyfilled by this - keep those Chrome 80-safe by hand.
    target: ['chrome80', 'safari14'],
    // Two pages, one bundle: the app, and the layout editor the hub serves at
    // /editor/ (docs/designs/layout-editor.md). Shared code (React, the
    // fonts) lands in shared chunks, fetched once.
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        editor: fileURLToPath(new URL('./editor.html', import.meta.url)),
      },
    },
  },
  server: {
    fs: {
      // lib/countdown.js re-exports ../frameserver/lib/countdown.mjs, above this
      // project's root; without this the dev server answers that import with a
      // 403. The workspace root is listed too, because setting `allow`
      // replaces Vite's default rather than adding to it.
      allow: [searchForWorkspaceRoot(process.cwd()), '..'],
    },
  },
})
