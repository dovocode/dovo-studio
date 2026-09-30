import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const directory = join(homedir(), '.cache', 'dovo-build')
const env = process.env.GITHUB_ENV
const output = process.env.GITHUB_OUTPUT
if (!env || !output) throw new Error('Build cache setup must run in GitHub Actions')
mkdirSync(directory, { recursive: true })
appendFileSync(
  env,
  [
    `ELECTRON_CACHE=${join(directory, 'electron')}`,
    `ELECTRON_BUILDER_CACHE=${join(directory, 'electron-builder')}`,
    `npm_package_config_node_gyp_devdir=${join(directory, 'node-gyp')}`,
    '',
  ].join('\n'),
)
appendFileSync(
  output,
  [
    `directory=${directory}`,
    `architecture=${process.arch}`,
    `node=${process.versions.node}`,
    '',
  ].join('\n'),
)
