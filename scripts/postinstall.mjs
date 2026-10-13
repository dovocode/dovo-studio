import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const target = process.env.DOVO_BUILD_TARGET || 'all'
if (target !== 'all' && target !== 'gpui') throw new Error(`Unknown build target: ${target}`)

// GPUI uses the runtime and embedded web content, but no React Native assets.
// Keep dependency lifecycle scripts enabled so SQLite and PTY modules are built.
const scripts =
  target === 'gpui'
    ? ['prepare-pty', 'build-browser-viewer', 'build-mcp-apps']
    : [
        'build-mobile-icons',
        'prepare-pty',
        'build-mobile-terminal',
        'build-mobile-mermaid',
        'prepare-mobile-markdown',
        'build-browser-viewer',
        'build-mcp-apps',
      ]

for (const script of scripts) {
  execFileSync(process.execPath, [fileURLToPath(new URL(`./${script}.mjs`, import.meta.url))], {
    stdio: 'inherit',
  })
}
