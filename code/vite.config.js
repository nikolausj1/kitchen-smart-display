import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
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

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __BUILD_STAMP__: JSON.stringify(buildStamp()),
  },
})
