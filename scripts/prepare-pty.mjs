import { chmodSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// node-pty 1.1.0's macOS prebuild ships spawn-helper with mode 0644.
// Restore the executable bit after every install, including clean checkouts.
if (process.platform === 'darwin') {
  const require = createRequire(new URL('../packages/runtime/package.json', import.meta.url))
  const root = dirname(require.resolve('node-pty/package.json'))
  for (const directory of [`prebuilds/darwin-${process.arch}`, 'build/Release']) {
    const helper = join(root, directory, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
