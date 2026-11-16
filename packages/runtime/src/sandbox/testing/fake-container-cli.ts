import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** A `docker`-compatible test CLI. `exec` runs the command on this machine with only the
 * forwarded environment, and the image's `/opt/dovo/bin` scripts map to the repository copies.
 * It checks launcher wiring and process cleanup, not container isolation. */
export function fakeContainerCli() {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-fake-cli-'))
  const bin = fileURLToPath(new URL('../../../sandbox/bin/', import.meta.url))
  const log = join(directory, 'calls.log')
  const cli = join(directory, 'docker')
  writeFileSync(
    cli,
    `#!/usr/bin/env node
const { spawn } = require('node:child_process')
const { appendFileSync } = require('node:fs')
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n')
if (args[0] !== 'exec') process.exit(0)
let index = 1, cwd = process.cwd()
const env = { PATH: process.env.PATH }
while (args[index]?.startsWith('-')) {
  const flag = args[index++]
  if (flag === '--workdir') cwd = args[index++]
  else if (flag === '--user') index++
  else if (flag === '--env') { const name = args[index++]; if (process.env[name] !== undefined) env[name] = process.env[name] }
}
index++ // container name
let command = args[index++]
if (command.startsWith('/opt/dovo/bin/')) command = ${JSON.stringify(bin)} + command.slice('/opt/dovo/bin/'.length)
const child = spawn(command, args.slice(index), { cwd, env, stdio: 'inherit' })
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
`,
  )
  chmodSync(cli, 0o755)
  return { cli, log, directory }
}
