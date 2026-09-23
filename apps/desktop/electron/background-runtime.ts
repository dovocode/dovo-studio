import {
  persistRuntimeEnvironment,
  readRuntimeEnvironment,
} from '../../api/src/runtime-environment.js'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, open, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { Effect } from 'effect'

interface BackgroundRuntimeOptions {
  home: string
  uid: number
  directory: string
  node: string
  entrypoint: string
  host: string
  port: string
  path: string
  ownerToken?: string
  environment?: NodeJS.ProcessEnv
  startupEnvironment?: Record<string, string>
}
const xml = (value: string) =>
  value.replace(/[<>&"']/g, (char) => {
    switch (char) {
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '&':
        return '&amp;'
      case '"':
        return '&quot;'
      default:
        return '&apos;'
    }
  })
export function backgroundRuntimeDefinition(options: BackgroundRuntimeOptions) {
  // A separate label per desktop profile prevents one profile from replacing another's service.
  const label = backgroundRuntimeLabel(options.directory)
  const log = join(options.directory, 'runtime-service.log')
  const env = {
    ...options.startupEnvironment,
    PATH: options.path,
    DOVO_DATABASE_PATH: join(options.directory, 'runtime.sqlite'),
    DOVO_HOST: options.host,
    PORT: options.port,
    DOVO_RUNTIME_ENV_FILE: join(options.directory, 'runtime-environment.json'),
  }
  return {
    label,
    log,
    plist: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(options.node)}</string><string>${xml(options.entrypoint)}</string></array>
<key>EnvironmentVariables</key><dict>${Object.entries(env)
      .map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`)
      .join('')}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer><key>ExitTimeOut</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(log)}</string>
<key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`,
  }
}
const launchctl = (args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      '/bin/launchctl',
      args,
      { timeout: args[0] === 'bootout' ? 40000 : 10000 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    )
  })

/** Install under the current login session; launchd owns the runtime after desktop quits. */
export function ensureBackgroundRuntime(
  options: BackgroundRuntimeOptions,
  command: (args: string[]) => Promise<string | void> = launchctl,
) {
  return Effect.tryPromise({
    try: async () => {
      const { label, log } = backgroundRuntimeDefinition(options)
      const domain = `gui/${options.uid}`
      const agents = join(options.home, 'Library', 'LaunchAgents')
      const path = join(agents, `${label}.plist`)
      await mkdir(agents, { recursive: true, mode: 0o700 })
      await mkdir(options.directory, { recursive: true, mode: 0o700 })
      const environmentPath = persistRuntimeEnvironment(options.directory, {
        ...options.environment,
        ...(options.ownerToken ? { DOVO_OWNER_TOKEN: options.ownerToken } : {}),
      })
      const savedEnvironment = readRuntimeEnvironment(environmentPath)
      // Node consumes trust-store settings before executing the runtime entrypoint.
      const startupEnvironment = Object.fromEntries(
        ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'].flatMap((key) =>
          savedEnvironment[key] ? [[key, savedEnvironment[key]]] : [],
        ),
      )
      const { plist } = backgroundRuntimeDefinition({ ...options, startupEnvironment })
      const handle = await open(log, 'a', 0o600)
      await handle.close()
      await writeFile(path + '.tmp', plist, { mode: 0o600 })
      await rename(path + '.tmp', path)
      try {
        await command(['print', `${domain}/${label}`])
        return // Never restart an existing service or interrupt its work.
      } catch {
        // bootstrap supplies the actionable error if the job cannot be loaded.
      }
      await command(['bootstrap', domain, path])
    },
    catch: (cause) =>
      new Error(
        'Could not start the Mac background runtime. Check runtime-service.log in the desktop data directory.',
        { cause },
      ),
  })
}

export const backgroundRuntimeLabel = (directory: string) =>
  `com.dovo.studio.runtime.${createHash('sha256').update(directory).digest('hex').slice(0, 16)}`

/** Only stop a service whose launchd PID matches this profile's authenticated discovery. */
export function stopBackgroundRuntimeForUpdate(
  directory: string,
  uid: number,
  expectedPid: number,
  command: (args: string[]) => Promise<string | void> = launchctl,
) {
  return Effect.tryPromise({
    try: async () => {
      const target = `gui/${uid}/${backgroundRuntimeLabel(directory)}`
      let description: string | void
      try {
        description = await command(['print', target])
      } catch {
        throw new Error(
          'This runtime is externally managed. Stop or update it through its supervisor before updating desktop.',
        )
      }
      const pid =
        typeof description === 'string'
          ? description.match(/(?:^|\n)\s*pid = (\d+)/)?.[1]
          : undefined
      if (Number(pid) !== expectedPid)
        throw new Error(
          'Runtime ownership changed. Recheck the runtime before installing the update.',
        )
      await command(['bootout', target])
      const deadline = Date.now() + 35000
      while (true) {
        try {
          process.kill(expectedPid, 0)
        } catch (cause) {
          if (cause instanceof Error && 'code' in cause && cause.code === 'ESRCH') return
          throw cause
        }
        if (Date.now() >= deadline)
          throw new Error('The background runtime did not exit. Update was cancelled.')
        await new Promise<void>((resolve) => setTimeout(resolve, 100))
      }
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}
