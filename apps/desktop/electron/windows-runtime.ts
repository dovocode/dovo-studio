import { waitForWslRuntime } from './wsl-runtime-health.js'
import { desktopRuntimeDirectory } from './runtime-data-directory.js'
import { app } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  windowsRuntimeChoiceSchema,
  type WindowsRuntimeChoice,
  type WindowsRuntimeStatus,
} from '@dovo/protocol'

const execute = promisify(execFile)
const path = () => join(desktopRuntimeDirectory(), 'windows-runtime.json')
export function readWindowsRuntimeChoice(): WindowsRuntimeChoice | undefined {
  try {
    return decode(windowsRuntimeChoiceSchema, JSON.parse(readFileSync(path(), 'utf8')))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}
export function writeWindowsRuntimeChoice(choice: WindowsRuntimeChoice | undefined) {
  if (!choice) {
    rmSync(path(), { force: true })
    return
  }
  writeFileSync(path() + '.tmp', JSON.stringify(decode(windowsRuntimeChoiceSchema, choice)), {
    mode: 0o600,
  })
  renameSync(path() + '.tmp', path())
}
export function parseWslDistributions(output: string, names?: string[]) {
  return output
    .replace(/\0/g, '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .flatMap((line) => {
      if (names) {
        const row = line.trim().replace(/^\*\s*/, '')
        const name = [...names]
          .sort((a, b) => b.length - a.length)
          .find((name) => row.startsWith(name) && /^\s/.test(row.slice(name.length)))
        const version = /\s([12])\s*$/.exec(row)?.[1]
        return name && version ? [{ name, version: Number(version) }] : []
      }
      const match = /^\s*\*?\s*(.+?)\s+\S+\s+([12])\s*$/.exec(line)
      return match?.[1] ? [{ name: match[1], version: Number(match[2]) }] : []
    })
}
const wsl = async (distribution: string, script: string, args: string[] = [], timeout = 30000) => {
  const result = await execute(
    'wsl.exe',
    ['--distribution', distribution, '--exec', 'sh', '-c', script, 'dovo', ...args],
    { timeout, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' },
  )
  return result.stdout.trim()
}
export async function windowsRuntimeStatus(): Promise<WindowsRuntimeStatus> {
  const choice = readWindowsRuntimeChoice()
  try {
    const options = {
      windowsHide: true,
      timeout: 10000,
      encoding: 'utf16le' as const,
    }
    const [result, quiet] = await Promise.all([
      execute('wsl.exe', ['--list', '--verbose'], options),
      execute('wsl.exe', ['--list', '--quiet'], options),
    ])
    const names = quiet.stdout
      .replace(/\0|\uFEFF/g, '')
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean)
    return {
      configured: !!choice,
      choice: choice ?? { mode: 'native' },
      distributions: parseWslDistributions(result.stdout, names),
    }
  } catch {
    return {
      configured: !!choice,
      choice: choice ?? { mode: 'native' },
      distributions: [],
      error:
        'WSL is unavailable. Install WSL 2 and a Linux distribution, then refresh. Native Windows works without WSL.',
    }
  }
}
const channel = () => (app.getVersion().includes('-nightly.') ? 'nightly' : 'stable')
const rootScript = 'base="$HOME/.local/share/dovo/desktop/' // Fixed suffixes only, never user-controlled shell text.
const archiveSchema = mutableStruct({
  draft: Schema.Boolean,
  assets: Schema.Array(
    mutableStruct({
      name: Schema.String,
      browser_download_url: Schema.String,
      digest: Schema.optional(Schema.String),
      size: Schema.Number,
    }),
  ),
})
export function selectWslArchive(value: unknown, version: string, architecture: 'x64' | 'arm64') {
  const release = decode(archiveSchema, value)
  const name = `Dovo-Server${version.includes('-nightly.') ? '-Nightly' : ''}-${version}-linux-${architecture}.tar.gz`
  const asset = release.assets.find((entry) => entry.name === name)
  if (
    release.draft ||
    !asset ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') ||
    asset.size <= 0 ||
    asset.size > 750_000_000 ||
    asset.browser_download_url !==
      `https://github.com/dovocode/dovo-studio/releases/download/v${version}/${name}`
  )
    throw new Error('The matching Linux runtime does not have a verified release archive.')
  return asset
}
export async function prepareWslRuntime(distribution: string) {
  const status = await windowsRuntimeStatus()
  if (!status.distributions.some((entry) => entry.name === distribution && entry.version === 2))
    throw new Error(
      'Choose an installed WSL 2 distribution. Refresh after installing or converting it.',
    )
  const arch = await wsl(distribution, 'getconf GNU_LIBC_VERSION >/dev/null || exit 1; uname -m')
  const architecture = arch === 'x86_64' ? 'x64' : arch === 'aarch64' ? 'arm64' : undefined
  if (!architecture) throw new Error('Dovo requires a glibc Linux distribution on x64 or ARM64.')
  const version = app.getVersion()
  if (!/^\d+\.\d+\.\d+(?:-nightly\.\d+)?$/.test(version))
    throw new Error('Use a published Dovo desktop build to install its matching WSL runtime.')
  const location = `${channel()}/versions/${version}`
  const installed = await wsl(
    distribution,
    `${rootScript}${location}"; test ! -f "$base/VERSION" || cat "$base/VERSION"`,
  )
  if (installed === version) return
  const response = await fetch(
    `https://api.github.com/repos/dovocode/dovo-studio/releases/tags/v${version}`,
    { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) },
  )
  if (!response.ok)
    throw new Error(
      `The matching WSL runtime release is unavailable (HTTP ${response.status}). Try again after this release is published.`,
    )
  const asset = selectWslArchive(await response.json(), version, architecture)
  await wsl(
    distribution,
    `set -eu
umask 077
${rootScript}${channel()}/versions"
mkdir -p "$base"
target="$base/$1"
[ ! -e "$target" ] || { echo 'Incomplete installation exists; inspect the WSL runtime directory before retrying.' >&2; exit 1; }
stage=$(mktemp -d "$base/.install.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
curl --fail --location --silent --show-error --max-time 600 --output "$stage/archive.tar.gz" "$2"
printf '%s  %s\\n' "$3" "$stage/archive.tar.gz" | sha256sum -c - >/dev/null
mkdir "$stage/runtime"
tar -xzf "$stage/archive.tar.gz" -C "$stage/runtime"
"$stage/runtime/libexec/node" "$stage/runtime/libexec/server/dist/server-cli.js" --help >/dev/null
mv "$stage/runtime" "$target"`,
    [version, asset.browser_download_url, asset.digest?.slice(7) ?? ''],
    660000,
  )
}

// Linux Node owns the entire runtime. Closing stdin asks its IPC child to shut down gracefully.
export const wslSupervisor = `
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const [entry, directory] = process.argv.slice(1);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const environment = { ...process.env };
for (const key of ['DOVO_OWNER_TOKEN', 'ELECTRON_RUN_AS_NODE', 'DOVO_RUNTIME_ENV_FILE', 'DOVO_DATABASE_PATH', 'DOVO_SETTINGS_PATH']) delete environment[key];
let listen = { port: '8787', host: '127.0.0.1' };
try { const saved = JSON.parse(readFileSync(join(directory, 'runtime-listen.json'), 'utf8')); listen = { port: new URL(saved.address).port, host: saved.bindHost }; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const child = spawn(process.execPath, [entry], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...environment, DOVO_DATABASE_PATH: join(directory, 'runtime.sqlite'), DOVO_DESKTOP_DUAL_LISTENER: '1', DOVO_RELEASE_DISTRIBUTION: 'desktop', PORT: listen.port, DOVO_HOST: listen.host } });
child.stdout.pipe(process.stderr); child.stderr.pipe(process.stderr);
child.on('message', message => { if (message?.type === 'ready') { const connection = JSON.parse(readFileSync(join(directory, 'runtime-connection.json'), 'utf8')); process.stdout.write('DOVO_WSL_READY ' + JSON.stringify({ address: connection.address, token: connection.token }) + '\\n'); } });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; process.stdin.destroy(); });
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; if (child.connected) child.disconnect(); else child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 10000); timer.unref(); child.once('exit', () => clearTimeout(timer)); };
process.stdin.resume(); process.stdin.on('end', stop); process.on('SIGTERM', stop); process.on('SIGINT', stop);
`
const connectionSchema = mutableStruct({
  address: Schema.String,
  token: Schema.String.pipe(Schema.check(Schema.isMinLength(32))),
})
let owned: { child: ChildProcess; connection?: typeof connectionSchema.Type } | undefined
let starting: Promise<typeof connectionSchema.Type> | undefined
export const wslRuntimeOwned = () => !!owned
export const wslRuntimeConnection = () =>
  owned && owned.child.exitCode === null && owned.child.signalCode === null
    ? owned.connection
    : undefined
export function startWslRuntime(distribution: string) {
  if (starting) return starting
  if (owned && owned.child.exitCode === null && owned.child.signalCode === null)
    return owned.connection
      ? Promise.resolve(owned.connection)
      : Promise.reject(new Error('The previous WSL runtime has not finished shutting down.'))
  starting = (async () => {
    await prepareWslRuntime(distribution)
    const child = spawn(
      'wsl.exe',
      [
        '--distribution',
        distribution,
        '--exec',
        'sh',
        '-c',
        `${rootScript}${channel()}/versions/${app.getVersion()}"; data="$HOME/.local/share/dovo/desktop/${channel()}/data"; exec "$base/libexec/node" --input-type=module -e "$1" "$base/libexec/server/dist/index.js" "$data"`,
        'dovo',
        wslSupervisor,
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    owned = { child }
    child.once('exit', () => {
      if (owned?.child === child) owned = undefined
    })
    let diagnostics = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      diagnostics = (diagnostics + chunk.toString()).slice(-4000)
    })
    try {
      const connection = await new Promise<typeof connectionSchema.Type>((resolve, reject) => {
        let output = ''
        const timeout = setTimeout(
          () => reject(new Error(`WSL runtime did not become ready. ${diagnostics}`)),
          45000,
        )
        const finish = (error?: Error, value?: typeof connectionSchema.Type) => {
          clearTimeout(timeout)
          if (error) reject(error)
          else if (value) resolve(value)
        }
        child.once('error', (error) => finish(error))
        child.once('exit', () => finish(new Error(`WSL runtime exited. ${diagnostics}`)))
        child.stdout?.on('data', (chunk: Buffer) => {
          output += chunk.toString()
          const end = output.indexOf('\n')
          if (end < 0) return
          try {
            const line = output.slice(0, end)
            if (!line.startsWith('DOVO_WSL_READY '))
              throw new Error('Unexpected WSL runtime response')
            finish(undefined, decode(connectionSchema, JSON.parse(line.slice(15))))
          } catch {
            finish(new Error('Invalid WSL runtime connection response'))
          }
        })
      })
      const url = new URL(connection.address)
      if (
        url.protocol !== 'http:' ||
        url.hostname !== '127.0.0.1' ||
        !url.port ||
        url.pathname !== '/' ||
        url.username ||
        url.password
      )
        throw new Error('WSL returned an unexpected local address')
      await waitForWslRuntime(connection, child)
      owned = { child, connection }
      return connection
    } catch (error) {
      try {
        await stopWslChild(child)
      } catch (shutdown) {
        throw new AggregateError(
          [error, shutdown],
          'WSL startup failed and shutdown was not confirmed',
        )
      }
      throw error
    }
  })().finally(() => {
    starting = undefined
  })
  return starting
}
export async function stopWslRuntime() {
  if (starting) await starting.catch(() => undefined)
  if (!owned) return
  const { child } = owned
  await stopWslChild(child)
  owned = undefined
}
function stopWslChild(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error('WSL runtime shutdown was not confirmed. Close running work before retrying.'),
        ),
      15000,
    )
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.stdin?.end()
  })
}
