import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, mkdir, writeFile, readFile, stat, rm, readdir } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { parse, stringify } from 'yaml'
import { Schema } from 'effect'
import { decode, mutableStruct, mutableArray } from '@dovo/protocol'
import { captureJiraContext, jiraConfigRoot } from './jira-context'
import { JiraWork } from './jira'
import { HttpError } from '../../../errors'
import type { runForgeCli } from '../integration/forge-cli'
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
const configSchema = mutableStruct({
  current_profile: Schema.String,
  profiles: mutableArray(
    mutableStruct({
      site: Schema.String,
      email: Schema.String,
      account_id: Schema.String,
      cloud_id: Schema.String,
      auth_type: Schema.String,
      token: Schema.String,
    }),
  ),
})
const original = {
  version: 1,
  current_profile: 'cloud-first:account-first',
  profiles: [
    {
      site: 'first.atlassian.net',
      email: 'first@example.com',
      account_id: 'account-first',
      cloud_id: 'cloud-first',
      auth_type: 'oauth',
      token: 'private-fixture-token-first',
    },
  ],
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dovo-jira-source-fixture-'))
  cleanup.push(() => rm(root, { force: true, recursive: true }))
  await mkdir(join(root, 'acli'))
  const file = join(root, 'acli', 'jira_config.yaml')
  await writeFile(file, stringify(original), { mode: 0o600 })
  vi.stubEnv('ACLI_CONFIG_DIR', root)
  const run = vi
    .fn<typeof runForgeCli>()
    .mockImplementation(async (_cmd, args, _input, _cwd, env) => {
      const configPath = join(env?.ACLI_CONFIG_DIR ?? root, 'acli', 'jira_config.yaml')
      let config: typeof configSchema.Type
      try {
        config = decode(configSchema, parse(await readFile(configPath, 'utf8')) as unknown)
      } catch {
        throw new HttpError(502, 'CLI rejected unauthenticated configuration')
      }
      const account = config.profiles.find(
        (profile) => config.current_profile === `${profile.cloud_id}:${profile.account_id}`,
      )!
      if (args.includes('auth'))
        return `Authenticated\nSite: ${account.site}\nEmail: ${account.email}`
      if (args.includes('project'))
        return JSON.stringify({
          key: 'TEAM',
          self: 'https://api.atlassian.com/project/1',
          issueTypes: [],
        })
      if (args.includes('create')) return JSON.stringify({ key: 'TEAM-1' })
      throw new Error('Unexpected fixture command')
    })
  return { root, file, run }
}
it('pins original Jira credentials during a global account change and removes the private snapshot', async () => {
  const f = await setup()
  const context = await captureJiraContext('acli', f.run)
  cleanup.push(context.close)
  expect(context.env.ACLI_CONFIG_DIR).not.toBe(f.root)
  await expect(context.accountId('https://first.atlassian.net', 'FIRST@example.com')).resolves.toBe(
    'account-first',
  )
  const privateFile = join(context.env.ACLI_CONFIG_DIR!, 'acli', 'jira_config.yaml')
  await writeFile(
    f.file,
    stringify({
      ...original,
      current_profile: 'cloud-first:account-second',
      profiles: [
        {
          ...original.profiles[0],
          site: 'second.atlassian.net',
          email: 'second@example.com',
          account_id: 'account-second',
          token: 'private-fixture-token-second',
        },
      ],
    }),
  )
  const status = await f.run('acli', ['jira', 'auth', 'status'], undefined, undefined, context.env)
  expect(status).toContain('first.atlassian.net')
  expect(status).not.toContain('second@example.com')
  expect(await readFile(privateFile, 'utf8')).toBe(stringify(original))
  await context.close()
  await expect(stat(context.env.ACLI_CONFIG_DIR!)).rejects.toMatchObject({ code: 'ENOENT' })
})
it('dispatches a Jira create through the captured site/account even if global ACLI switches between verification and write', async () => {
  const f = await setup()
  const run = f.run.getMockImplementation()!
  let switched = false
  const recorded: string[] = []
  f.run.mockImplementation(async (cmd, args, input, cwd, env, timeout) => {
    const result = await run(cmd, args, input, cwd, env, timeout)
    if (args.includes('project') && !switched) {
      switched = true
      await writeFile(
        f.file,
        stringify({
          ...original,
          current_profile: 'cloud-first:account-second',
          profiles: [
            {
              ...original.profiles[0],
              site: 'second.atlassian.net',
              email: 'second@example.com',
              account_id: 'account-second',
            },
          ],
        }),
      )
    }
    if (args.includes('workitem') && args.includes('create')) {
      const profile = decode(
        configSchema,
        parse(
          await readFile(join(env!.ACLI_CONFIG_DIR!, 'acli', 'jira_config.yaml'), 'utf8'),
        ) as unknown,
      ).profiles[0]!
      recorded.push(`${profile.site}/${profile.account_id}`)
    }
    return result
  })
  const jira = new JiraWork('acli', { site: 'https://first.atlassian.net', project: 'TEAM' }, f.run)
  try {
    const result = await jira.createIssue({
      title: 'Mock issue',
      body: 'Private draft',
      type: 'Task',
      assignees: [],
      labels: [],
    })
    expect(result.url).toBe('https://first.atlassian.net/browse/TEAM-1')
    expect(recorded).toEqual(['first.atlassian.net/account-first'])
    expect(f.run.mock.calls.some(([, args]) => args.includes('switch'))).toBe(false)
  } finally {
    await jira.close()
  }
  const directories = new Set(
    f.run.mock.calls.map((call) => call[4]?.ACLI_CONFIG_DIR).filter((value) => value !== undefined),
  )
  for (const directory of directories)
    await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
})
it('fails closed when the CLI ignores isolated account configuration', async () => {
  const f = await setup()
  f.run.mockResolvedValue('Authenticated\nSite: first.atlassian.net\nEmail: first@example.com')
  const jira = new JiraWork('acli', { site: 'https://first.atlassian.net', project: 'TEAM' }, f.run)
  try {
    await expect(
      jira.createIssue({
        title: 'Never written',
        body: '',
        type: 'Task',
        assignees: [],
        labels: [],
      }),
    ).rejects.toThrow('ignores isolated')
  } finally {
    await jira.close()
  }
  expect(f.run.mock.calls.some(([, args]) => args.includes('workitem'))).toBe(false)
  expect(await readFile(f.file, 'utf8')).toBe(stringify(original))
})
it.runIf(process.platform !== 'win32')(
  'protects the isolated and retained Jira credentials with private POSIX permissions',
  async () => {
    const f = await setup()
    const context = await captureJiraContext('acli', f.run)
    cleanup.push(context.close)
    expect(
      (await stat(join(context.env.ACLI_CONFIG_DIR!, 'acli', 'jira_config.yaml'))).mode & 0o777,
    ).toBe(0o600)
    expect((await stat(context.env.ACLI_CONFIG_DIR!)).mode & 0o777).toBe(0o700)
    await context.close()
    const retained = join(f.root, 'acli', 'dovo-jira-accounts')
    expect((await stat(retained)).mode & 0o777).toBe(0o700)
    const state = (await readdir(retained)).find((file) => file.endsWith('.json'))!
    expect((await stat(join(retained, state))).mode & 0o777).toBe(0o600)
  },
)
it('uses supported configuration roots without changing the process-wide account environment', () => {
  const fixtureHome = join(tmpdir(), 'fixture-home')
  expect(
    jiraConfigRoot({ ACLI_CONFIG_DIR: join(tmpdir(), 'custom-root') }, 'linux', fixtureHome),
  ).toBe(join(tmpdir(), 'custom-root'))
  expect(jiraConfigRoot({ XDG_CONFIG_HOME: join(tmpdir(), 'xdg') }, 'linux', fixtureHome)).toBe(
    join(tmpdir(), 'xdg'),
  )
  expect(jiraConfigRoot({}, 'darwin', fixtureHome)).toBe(
    join(fixtureHome, 'Library', 'Application Support'),
  )
  expect(jiraConfigRoot({ APPDATA: join(tmpdir(), 'appdata') }, 'win32', fixtureHome)).toBe(
    join(tmpdir(), 'appdata'),
  )
  expect(jiraConfigRoot({}, 'win32', fixtureHome)).toBe(join(fixtureHome, 'AppData', 'Roaming'))
  expect(() => jiraConfigRoot({ ACLI_CONFIG_DIR: 'relative' }, 'linux', fixtureHome)).toThrow(
    'absolute directory',
  )
})
it('retains CLI-renewed tokens privately, reuses them, and respects a new source login', async () => {
  const f = await setup()
  const context = await captureJiraContext('acli', f.run)
  await context.accountId('https://first.atlassian.net', 'first@example.com')
  const firstRevision = context.revision?.()
  const privateFile = join(context.env.ACLI_CONFIG_DIR!, 'acli', 'jira_config.yaml')
  await writeFile(
    privateFile,
    stringify({
      ...original,
      profiles: [{ ...original.profiles[0], token: 'renewed-private-fixture-token' }],
    }),
  )
  await context.close()
  expect(await readFile(f.file, 'utf8')).toBe(stringify(original))
  const next = await captureJiraContext('acli', f.run)
  cleanup.push(next.close)
  await next.accountId('https://first.atlassian.net', 'first@example.com')
  expect(
    decode(
      configSchema,
      parse(
        await readFile(join(next.env.ACLI_CONFIG_DIR!, 'acli', 'jira_config.yaml'), 'utf8'),
      ) as unknown,
    ).profiles[0]?.token,
  ).toBe('renewed-private-fixture-token')
  expect(next.revision?.()).toBe(firstRevision)
  await next.close()
  await writeFile(
    f.file,
    stringify({
      ...original,
      profiles: [{ ...original.profiles[0], token: 'manual-new-login-token' }],
    }),
  )
  const changed = await captureJiraContext('acli', f.run)
  cleanup.push(changed.close)
  await changed.accountId('https://first.atlassian.net', 'first@example.com')
  expect(changed.revision?.()).not.toBe(firstRevision)
  expect(
    decode(
      configSchema,
      parse(
        await readFile(join(changed.env.ACLI_CONFIG_DIR!, 'acli', 'jira_config.yaml'), 'utf8'),
      ) as unknown,
    ).profiles[0]?.token,
  ).toBe('manual-new-login-token')
})
it('serializes same-account contexts so a later operation observes the latest renewed token', async () => {
  const f = await setup()
  const first = await captureJiraContext('acli', f.run)
  cleanup.push(first.close)
  await first.accountId('https://first.atlassian.net', 'first@example.com')
  let ready = false
  const capturing = captureJiraContext('acli', f.run).then((context) => {
    ready = true
    return context
  })
  await new Promise((resolve) => setImmediate(resolve))
  expect(ready).toBe(false)
  await writeFile(
    join(first.env.ACLI_CONFIG_DIR!, 'acli', 'jira_config.yaml'),
    stringify({
      ...original,
      profiles: [{ ...original.profiles[0], token: 'latest-private-token' }],
    }),
  )
  await first.close()
  const second = await capturing
  cleanup.push(second.close)
  expect(
    decode(
      configSchema,
      parse(
        await readFile(join(second.env.ACLI_CONFIG_DIR!, 'acli', 'jira_config.yaml'), 'utf8'),
      ) as unknown,
    ).profiles[0]?.token,
  ).toBe('latest-private-token')
})
it('keeps a pinned account alive for a background cache load and cleans it after the last lease', async () => {
  const f = await setup()
  const jira = new JiraWork('acli', { site: 'https://first.atlassian.net', project: 'TEAM' }, f.run)
  await jira.identity()
  const directory = f.run.mock.calls.at(-1)?.[4]?.ACLI_CONFIG_DIR
  const release = jira.retain()
  await jira.close()
  expect(await stat(directory!)).toBeDefined()
  await expect(jira.identity()).resolves.toBe(
    JSON.stringify(['https://first.atlassian.net', 'account-first']),
  )
  await release()
  await expect(stat(directory!)).rejects.toMatchObject({ code: 'ENOENT' })
})
it('loads a retained renewal before the first authenticated status command', async () => {
  const f = await setup()
  const first = await captureJiraContext('acli', f.run)
  await writeFile(
    join(first.env.ACLI_CONFIG_DIR!, 'acli', 'jira_config.yaml'),
    stringify({
      ...original,
      profiles: [{ ...original.profiles[0], token: 'latest-renewed-token' }],
    }),
  )
  await first.close()
  const run = f.run.getMockImplementation()!
  const authenticatedTokens: string[] = []
  f.run.mockImplementation(async (cmd, args, input, cwd, env, timeout) => {
    const result = await run(cmd, args, input, cwd, env, timeout)
    if (args.includes('auth'))
      authenticatedTokens.push(
        decode(
          configSchema,
          parse(
            await readFile(join(env!.ACLI_CONFIG_DIR!, 'acli', 'jira_config.yaml'), 'utf8'),
          ) as unknown,
        ).profiles[0]!.token,
      )
    return result
  })
  const jira = new JiraWork('acli', { site: 'https://first.atlassian.net', project: 'TEAM' }, f.run)
  try {
    await jira.identity()
    expect(authenticatedTokens).toEqual(['latest-renewed-token'])
  } finally {
    await jira.close()
  }
})
it('uses the captured current profile rather than the first account at the same site', async () => {
  const f = await setup()
  await writeFile(
    f.file,
    stringify({
      ...original,
      current_profile: 'cloud-first:account-second',
      profiles: [
        original.profiles[0],
        { ...original.profiles[0], account_id: 'account-second', email: 'second@example.com' },
      ],
    }),
  )
  const jira = new JiraWork('acli', { site: 'https://first.atlassian.net', project: 'TEAM' }, f.run)
  try {
    await expect(jira.identity()).resolves.toBe(
      JSON.stringify(['https://first.atlassian.net', 'account-second']),
    )
  } finally {
    await jira.close()
  }
})
it('rejects an unknown profile selector instead of choosing or switching accounts', async () => {
  const f = await setup()
  await writeFile(f.file, stringify({ ...original, current_profile: 'unknown-format' }))
  await expect(captureJiraContext('acli', f.run)).rejects.toThrow('selected Jira CLI profile')
  expect(f.run).not.toHaveBeenCalled()
})
it.each(['email', 'auth_type', 'account_id', 'site', 'cloud_id', 'current_profile'] as const)(
  'rejects changed %s metadata before admitting or retaining a renewed credential',
  async (field) => {
    const f = await setup()
    const context = await captureJiraContext('acli', f.run)
    cleanup.push(context.close)
    const changed =
      field === 'current_profile'
        ? { ...original, current_profile: 'cloud-first:account-second' }
        : { ...original, profiles: [{ ...original.profiles[0], [field]: 'changed-value' }] }
    await writeFile(
      join(context.env.ACLI_CONFIG_DIR!, 'acli', 'jira_config.yaml'),
      stringify(changed),
    )
    await expect(
      context.accountId('https://first.atlassian.net', 'first@example.com'),
    ).rejects.toThrow('configuration changed')
    await expect(context.close()).rejects.toThrow('configuration changed')
    expect(await readdir(join(f.root, 'acli', 'dovo-jira-accounts'))).toEqual([])
    expect(await readFile(f.file, 'utf8')).toBe(stringify(original))
  },
)
async function existingAccountLock(file: string, pid: number) {
  const key = createHash('sha256')
    .update(JSON.stringify([file, 'https://first.atlassian.net', 'account-first']))
    .digest('hex')
  const directory = join(dirname(file), 'dovo-jira-accounts')
  const lock = join(directory, `${key}.json.lock`)
  const nonce = randomUUID()
  await mkdir(lock, { recursive: true })
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid, nonce }))
  return { lock, nonce }
}
it('recovers a crashed process account lock without replaying a provider write', async () => {
  const f = await setup()
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
  const pid = child.pid
  await once(child, 'exit')
  if (!pid) throw new Error('Missing fixture child PID')
  const { lock, nonce } = await existingAccountLock(f.file, pid)
  const context = await captureJiraContext('acli', f.run)
  cleanup.push(context.close)
  await expect(context.accountId('https://first.atlassian.net', 'first@example.com')).resolves.toBe(
    'account-first',
  )
  expect(await stat(`${lock}.recovered-${nonce}`)).toBeDefined()
  expect(JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')) as unknown).toMatchObject({
    pid: process.pid,
  })
  expect(f.run.mock.calls.some(([, args]) => args.includes('workitem'))).toBe(false)
  await context.close()
  await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' })
})
it('protects live process account locks and leaves the original credentials untouched', async () => {
  const f = await setup()
  const { lock, nonce } = await existingAccountLock(f.file, process.pid)
  await expect(captureJiraContext('acli', f.run)).rejects.toThrow('active Jira operation')
  expect(JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')) as unknown).toEqual({
    pid: process.pid,
    nonce,
  })
  expect(await readFile(f.file, 'utf8')).toBe(stringify(original))
  expect(f.run).toHaveBeenCalledTimes(1) // Only the unauthenticated selector capability probe.
})
it('does not reclaim an account lock when its process state cannot be verified', async () => {
  const f = await setup()
  const { lock, nonce } = await existingAccountLock(f.file, process.pid)
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('permission'), { code: 'EPERM' })
  })
  await expect(captureJiraContext('acli', f.run)).rejects.toThrow('active Jira operation')
  expect(JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')) as unknown).toEqual({
    pid: process.pid,
    nonce,
  })
})
it('redacts malformed private credential documents from verification and close errors', async () => {
  const f = await setup()
  const context = await captureJiraContext('acli', f.run)
  cleanup.push(context.close)
  await writeFile(
    join(context.env.ACLI_CONFIG_DIR!, 'acli', 'jira_config.yaml'),
    stringify({ ...original, profiles: 'private-account-token-email' }),
  )
  await expect(
    context.accountId('https://first.atlassian.net', 'first@example.com'),
  ).rejects.toMatchObject({
    status: 409,
    message:
      'The isolated Jira account configuration changed unexpectedly. Refresh before continuing.',
  })
  await expect(context.close()).rejects.toMatchObject({
    status: 409,
    message:
      'The isolated Jira account configuration changed unexpectedly. Refresh before continuing.',
  })
})
