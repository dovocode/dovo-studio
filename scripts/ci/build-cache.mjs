import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const directory = join(homedir(), '.cache', 'dovo-build')
const env = process.env.GITHUB_ENV
const output = process.env.GITHUB_OUTPUT
if (!env || !output) throw new Error('Build cache setup must run in GitHub Actions')
mkdirSync(directory, { recursive: true })
const metadata = join(homedir(), '.cache', 'dovo-pnpm-metadata')
const pnpm = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).packageManager
appendFileSync(
  env,
  [
    `ELECTRON_CACHE=${join(directory, 'electron')}`,
    `ELECTRON_BUILDER_CACHE=${join(directory, 'electron-builder')}`,
    `npm_package_config_node_gyp_devdir=${join(directory, 'node-gyp')}`,
    `PNPM_CONFIG_CACHE_DIR=${metadata}`,
    '',
  ].join('\n'),
)
appendFileSync(
  output,
  [
    `directory=${directory}`,
    `architecture=${process.arch}`,
    `node=${process.versions.node}`,
    `metadata=${metadata}`,
    `pnpm=${pnpm}`,
    `day=${new Date().toISOString().slice(0, 10)}`,
    '',
  ].join('\n'),
)
