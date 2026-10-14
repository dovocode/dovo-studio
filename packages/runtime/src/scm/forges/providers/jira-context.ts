import { Schema } from 'effect'
import { parse, parseDocument, stringify } from 'yaml'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, mkdir, mkdtemp, writeFile, rm, chmod, rename } from 'node:fs/promises'
import { homedir, tmpdir, platform } from 'node:os'
import { isAbsolute, join, dirname } from 'node:path'
import { decode, mutableStruct, mutableArray, minValue, maxValue } from '@dovo/protocol'
import { HttpError } from '../../../errors.js'
import { runForgeCli } from '../integration/forge-cli.js'

const profileSchema = mutableStruct({
  site: minValue(Schema.String, 1),
  email: minValue(Schema.String, 1),
  cloud_id: minValue(Schema.String, 1),
  account_id: Schema.optional(Schema.String),
  auth_type: Schema.optional(Schema.String),
  token: Schema.Unknown,
})
const configSchema = mutableStruct({
  version: Schema.Number,
  current_profile: minValue(Schema.String, 1),
  profiles: maxValue(mutableArray(profileSchema), 100),
})
export type JiraCliContext = {
  env: NodeJS.ProcessEnv
  accountId: (site: string, email: string) => string | Promise<string>
  revision?: () => string
  close: () => Promise<void>
}
const renewalSchema = mutableStruct({
  fingerprint: minValue(Schema.String, 1),
  profile: maxValue(minValue(Schema.String, 1), 1024 * 1024),
})
const accountOperations = new Map<string, Promise<void>>()
const lockOwnerSchema = mutableStruct({
  pid: minValue(Schema.Number.pipe(Schema.check(Schema.isInt())), 1),
  nonce: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9-]{36}$/))),
})
function processIsDead(pid: number) {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    // Permission failures and unknown process states must never authorize reclaiming a lock.
    return error instanceof Error && 'code' in error && error.code === 'ESRCH'
  }
}
async function acquireFileLock(lock: string) {
  const staged = `${lock}.${randomUUID()}.tmp`
  await mkdir(staged, { mode: 0o700 })
  try {
    await writeFile(
      join(staged, 'owner.json'),
      JSON.stringify({ pid: process.pid, nonce: randomUUID() }),
      {
        mode: 0o600,
        flag: 'wx',
      },
    )
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // The owner record exists before the directory becomes visible. A crash cannot
        // leave a partially initialized account lock with no recoverable PID.
        await rename(staged, lock)
        return
      } catch {
        let owner: typeof lockOwnerSchema.Type
        try {
          owner = decode(
            lockOwnerSchema,
            JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')) as unknown,
          )
        } catch {
          throw new HttpError(
            409,
            'Could not verify the Jira account lock owner. Refresh after checking this runtime’s account state.',
          )
        }
        if (!processIsDead(owner.pid))
          throw new HttpError(
            409,
            'Another runtime has an active Jira operation for this account. Wait for it to finish and refresh.',
          )
        // Keep the recovered generation as a small, nonsecret tombstone. A competing
        // delayed reclaimer of this same generation cannot rename a newer live lock
        // over its nonempty destination (on POSIX or Windows).
        try {
          await rename(lock, `${lock}.recovered-${owner.nonce}`)
        } catch {
          throw new HttpError(
            409,
            'The Jira account lock changed during recovery. Refresh before continuing.',
          )
        }
      }
    }
    throw new HttpError(409, 'Could not acquire the Jira account lock. Refresh before continuing.')
  } finally {
    await rm(staged, { recursive: true, force: true })
  }
}
async function acquireAccount(key: string) {
  const previous = accountOperations.get(key) ?? Promise.resolve()
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => held)
  accountOperations.set(key, queued)
  await previous
  return () => {
    release()
    if (accountOperations.get(key) === queued) accountOperations.delete(key)
  }
}
/** ACLI_CONFIG_DIR is a parent config root; ACLI appends its own `acli` directory. */
export function jiraConfigRoot(
  env: NodeJS.ProcessEnv = process.env,
  os = platform(),
  homeDirectory = homedir(),
) {
  const configured = env.ACLI_CONFIG_DIR
  const root =
    configured ??
    (os === 'win32'
      ? (env.APPDATA ?? join(homeDirectory, 'AppData', 'Roaming'))
      : os === 'darwin'
        ? join(homeDirectory, 'Library', 'Application Support')
        : (env.XDG_CONFIG_HOME ?? join(homeDirectory, '.config')))
  if (!isAbsolute(root))
    throw new HttpError(
      409,
      'Jira configuration must use an absolute directory. Check ACLI_CONFIG_DIR on the runtime.',
    )
  return root
}
function normalizedSite(site: string) {
  try {
    return new URL(site.startsWith('https://') ? site : `https://${site}`).origin
  } catch {
    throw new HttpError(
      409,
      'The Jira CLI configuration has an invalid site. Sign in again on this runtime.',
    )
  }
}
function sameAccount(a: typeof profileSchema.Type, b: typeof profileSchema.Type) {
  return (
    a.account_id === b.account_id &&
    a.cloud_id === b.cloud_id &&
    normalizedSite(a.site) === normalizedSite(b.site) &&
    a.email.toLowerCase() === b.email.toLowerCase() &&
    a.auth_type === b.auth_type
  )
}
/** Copy an immutable credential configuration for this operation, without changing the user's
 * global active account. Every CLI invocation, including verification and writes, uses it.
 * Probe an empty context first to fail closed when an older executable ignores the selector. */
export async function captureJiraContext(
  executable: string,
  run: typeof runForgeCli = runForgeCli,
  cwd?: string,
): Promise<JiraCliContext> {
  const sourceFile = join(jiraConfigRoot(), 'acli', 'jira_config.yaml')
  let contents: Buffer
  let config: typeof configSchema.Type
  try {
    contents = await readFile(sourceFile)
    if (contents.byteLength > 1024 * 1024) throw new Error('Oversized configuration')
    config = decode(configSchema, parse(contents.toString('utf8')) as unknown)
  } catch {
    throw new HttpError(
      409,
      'Could not capture a Jira account configuration. Sign in with acli on this runtime and check ACLI_CONFIG_DIR before making changes.',
    )
  }
  // ACLI 1.3 uses cloud_id:account_id for current_profile, verified against the
  // installed configuration. Unknown layouts fail closed; never guess/switch a profile.
  const matching = config.profiles
    .map((profile, index) => ({ profile, index }))
    .filter(
      ({ profile }) =>
        profile.account_id &&
        config.current_profile === `${profile.cloud_id}:${profile.account_id}`,
    )
  if (matching.length !== 1 || !matching[0]?.profile.account_id)
    throw new HttpError(
      409,
      'Could not identify the selected Jira CLI profile safely. Sign in again on this runtime and refresh.',
    )
  const { profile, index } = matching[0]
  const accountId = profile.account_id
  if (!accountId)
    throw new HttpError(409, 'Jira account identity unavailable. Refresh before continuing.')
  const directory = await mkdtemp(join(tmpdir(), 'dovo-jira-account-'))
  const configFile = join(directory, 'acli', 'jira_config.yaml')
  let selected: { fingerprint: string; stateFile: string } | undefined
  let releaseAccount: (() => void) | undefined
  let ownedLock: string | undefined
  let closed = false
  const currentProfile = async () => {
    try {
      const current = decode(configSchema, parse(await readFile(configFile, 'utf8')) as unknown)
      const updated = current.profiles[index]
      if (
        current.current_profile !== config.current_profile ||
        !updated ||
        !updated.token ||
        !sameAccount(updated, profile)
      )
        throw new Error('Changed configuration')
      return updated
    } catch {
      // Parser/schema diagnostics can include the credential document. Never expose it.
      throw new HttpError(
        409,
        'The isolated Jira account configuration changed unexpectedly. Refresh before continuing.',
      )
    }
  }
  const close = async () => {
    if (closed) return
    closed = true
    try {
      if (selected) {
        const updated = await currentProfile()
        const state = { fingerprint: selected.fingerprint, profile: stringify(updated) }
        const staged = `${selected.stateFile}.${randomUUID()}.tmp`
        try {
          await writeFile(staged, JSON.stringify(state), { mode: 0o600, flag: 'wx' })
          await rename(staged, selected.stateFile)
        } finally {
          await rm(staged, { force: true })
        }
      }
    } finally {
      try {
        if (ownedLock) {
          // Unpublish the entire generation atomically before cleanup. Removing its
          // owner record in place would briefly expose an empty/acquirable directory.
          const released = `${ownedLock}.released-${randomUUID()}`
          await rename(ownedLock, released)
          await rm(released, { recursive: true, force: true })
        }
      } finally {
        releaseAccount?.()
        await rm(directory, { recursive: true, force: true })
      }
    }
  }
  const env = { ACLI_CONFIG_DIR: directory, ACLI_LOG_ENABLED: 'false', ACLI_LOG_FILE: undefined }
  try {
    await mkdir(join(directory, 'acli'), { mode: 0o700 })
    let emptyStatus: string | undefined
    try {
      emptyStatus = await run(executable, ['jira', 'auth', 'status'], undefined, cwd, env)
    } catch (error) {
      // ACLI reports unsigned-in contexts with a nonzero exit. Other failures must still
      // fail the subsequent authenticated verification, before any data command or write.
      if (!(error instanceof HttpError) || error.status !== 502) throw error
    }
    if (emptyStatus && /(?:^|\n)\s*(?:Site|Email):/m.test(emptyStatus))
      throw new HttpError(
        409,
        'This ACLI executable ignores isolated Jira configuration. Update ACLI before making changes; the runtime will not switch your global account.',
      )
    await writeFile(configFile, contents, { mode: 0o600 })
    await chmod(configFile, 0o600)
    const key = createHash('sha256')
      .update(JSON.stringify([sourceFile, normalizedSite(profile.site), accountId]))
      .digest('hex')
    releaseAccount = await acquireAccount(key)
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          profile.site,
          profile.cloud_id,
          profile.account_id,
          profile.email.toLowerCase(),
          profile.auth_type,
          profile.token,
        ]),
      )
      .digest('hex')
    const stateDirectory = join(dirname(sourceFile), 'dovo-jira-accounts')
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
    await chmod(stateDirectory, 0o700)
    const stateFile = join(stateDirectory, `${key}.json`)
    await acquireFileLock(`${stateFile}.lock`)
    ownedLock = `${stateFile}.lock`
    try {
      const state = decode(renewalSchema, JSON.parse(await readFile(stateFile, 'utf8')) as unknown)
      if (state.fingerprint === fingerprint) {
        const refreshed = decode(profileSchema, parse(state.profile) as unknown)
        if (!refreshed.token || !sameAccount(refreshed, profile))
          throw new HttpError(
            409,
            'The retained Jira credential does not match this account. Sign in again and refresh.',
          )
        const document = parseDocument(contents.toString('utf8'))
        document.setIn(['profiles', index, 'token'], refreshed.token)
        await writeFile(configFile, document.toString())
      }
    } catch (error) {
      // Restore renewal before ANY authenticated CLI invocation. Missing state is the
      // first source credential; unreadable state must not resurrect an older token.
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
        throw new HttpError(
          409,
          'Could not restore the retained Jira credential safely. Sign in again on this runtime and refresh.',
        )
    }
    selected = { fingerprint, stateFile }
    return {
      env,
      close,
      revision: () => selected?.fingerprint ?? '',
      accountId: async (site, email) => {
        if (
          normalizedSite(profile.site) !== normalizedSite(site) ||
          profile.email.toLowerCase() !== email.toLowerCase()
        )
          throw new HttpError(409, 'The isolated Jira account changed. Refresh before continuing.')
        await currentProfile()
        return accountId
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
