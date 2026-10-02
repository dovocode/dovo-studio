import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Runs the actual Objective-C worker without needing a simulator or provisioning profile.
if (process.platform !== 'darwin') throw new Error('This native renderer check requires macOS')
const require = createRequire(new URL('../apps/mobile/package.json', import.meta.url))
const root = dirname(require.resolve('react-native-enriched-markdown/package.json'))
const directory = mkdtempSync(join(tmpdir(), 'dovo-markdown-queue-'))
try {
  const binary = join(directory, 'check')
  execFileSync(
    'xcrun',
    [
      'clang',
      '-fobjc-arc',
      '-framework',
      'Foundation',
      '-I',
      join(root, 'ios/utils'),
      join(root, 'ios/utils/ENRMAsyncRenderCoordinator.m'),
      fileURLToPath(new URL('./fixtures/markdown-render-queue.m', import.meta.url)),
      '-o',
      binary,
    ],
    { stdio: 'inherit' },
  )
  execFileSync(binary, { stdio: 'inherit', timeout: 15000 })
} finally {
  rmSync(directory, { recursive: true, force: true })
}
