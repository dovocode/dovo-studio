import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { runtimeSmoke } from './runtime-smoke.mjs'

if (!process.argv[2]) throw new Error('Usage: gpui-smoke.mjs <extracted-package-directory>')
const directory = resolve(process.argv[2])
const base =
  process.platform === 'darwin'
    ? join(directory, 'Dovo Studio GPUI.app/Contents/Resources')
    : directory
const binary =
  process.platform === 'darwin'
    ? join(directory, 'Dovo Studio GPUI.app/Contents/MacOS/dovo-desktop-gpui')
    : join(base, `dovo-desktop-gpui${process.platform === 'win32' ? '.exe' : ''}`)
execFileSync(binary, ['--help'], { stdio: 'inherit', timeout: 30000 })
execFileSync(
  join(base, 'libexec', process.platform === 'win32' ? 'node.exe' : 'node'),
  ['--input-type=module', '--eval', runtimeSmoke],
  { cwd: join(base, 'libexec/server'), stdio: 'inherit', timeout: 60000 },
)
