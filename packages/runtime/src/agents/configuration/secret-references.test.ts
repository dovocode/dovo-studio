import { expect, it } from 'vite-plus/test'
import { OwnedProcessShutdownError } from '../execution/stop-owned-child.js'
import { SecretReferences } from './secret-references.js'
import type { AgentSecretReference, AgentSecretReferences } from '@dovo/protocol'

const discovery = (envSecrets: AgentSecretReferences) => ({
  provider: 'codex' as const,
  endpoint: '',
  model: '',
  envSecrets,
})
function barrier<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('resolves references without changing configuration, shares reads and explicitly refreshes rotation', async () => {
  let value = 'first-secret'
  let calls = 0
  const resolver = new SecretReferences(
    () => ({ HOST_SECRET: value }),
    async () => {
      calls++
      return value
    },
  )
  const agent = {
    ...discovery({
      TOKEN: { provider: 'onepassword' as const, reference: 'op://vault/item/password' },
    }),
    env: { TOKEN: 'literal', OTHER: 'kept' },
  }
  const [one, two] = await Promise.all([resolver.resolve(agent), resolver.resolve(agent)])
  expect(one.env).toEqual({ TOKEN: 'first-secret', OTHER: 'kept' })
  expect(two.env).toEqual(one.env)
  expect(one.envSecrets).toBeUndefined()
  expect(agent.envSecrets.TOKEN.reference).toBe('op://vault/item/password')
  expect(agent.env.TOKEN).toBe('literal')
  expect(calls).toBe(1)
  value = 'rotated-secret'
  expect((await resolver.resolve(agent)).env?.TOKEN).toBe('first-secret')
  resolver.refresh()
  expect((await resolver.resolve(agent)).env?.TOKEN).toBe('rotated-secret')
  expect(calls).toBe(2)
  expect(
    (
      await resolver.resolve(
        discovery({ TOKEN: { provider: 'environment', reference: 'HOST_SECRET' } }),
      )
    ).env?.TOKEN,
  ).toBe('rotated-secret')
  await resolver.close()
})

it('uses explicit provider arguments and preserves significant whitespace and multiline values', async () => {
  const calls: { command: string; args: string[] }[] = []
  const resolver = new SecretReferences(undefined, async (command, args) => {
    calls.push({ command, args })
    return command === 'infisical'
      ? JSON.stringify([{ secretKey: 'SERVICE_KEY', secretValue: '  value\nwith newline\n' }])
      : command === 'bw'
        ? ' value\n\n'
        : ' op value\n'
  })
  const references: AgentSecretReferences = {
    OP: {
      provider: 'onepassword',
      reference: 'op://work/service/password',
      account: 'work.1password.com',
    },
    BW: { provider: 'bitwarden', reference: 'item-id', field: 'username' },
    INF: {
      provider: 'infisical',
      reference: 'SERVICE_KEY',
      projectId: 'project-id',
      environment: 'production',
      path: '/backend',
      domain: 'https://eu.infisical.com/api',
    },
  }
  expect((await resolver.resolve(discovery(references))).env).toEqual({
    OP: ' op value\n',
    BW: ' value\n',
    INF: '  value\nwith newline\n',
  })
  expect(calls).toContainEqual({
    command: 'op',
    args: [
      '--cache=false',
      'read',
      '--no-newline',
      '--account=work.1password.com',
      'op://work/service/password',
    ],
  })
  expect(calls).toContainEqual({ command: 'bw', args: ['get', 'username', 'item-id'] })
  expect(calls).toContainEqual({
    command: 'infisical',
    args: [
      'secrets',
      'get',
      'SERVICE_KEY',
      '--projectId=project-id',
      '--env=production',
      '--path=/backend',
      '--output=json',
      '--silent',
      '--log-destination=stderr',
      '--domain=https://eu.infisical.com/api',
    ],
  })
  await resolver.close()
})

it('caches failures without provider output and rejects missing or ambiguous Infisical results', async () => {
  let calls = 0
  const resolver = new SecretReferences(undefined, async () => {
    calls++
    throw new Error('stderr contains synthetic-private-value')
  })
  const agent = discovery({
    TOKEN: { provider: 'onepassword', reference: 'op://work/service/password' },
  })
  for (let at = 0; at < 2; at++) {
    const error = await resolver.resolve(agent).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain('Environment variable TOKEN')
    expect(String(error)).not.toContain('synthetic-private-value')
  }
  expect(calls).toBe(1)
  const reference: AgentSecretReference = {
    provider: 'infisical',
    reference: 'TOKEN',
    projectId: 'project',
    environment: 'dev',
    path: '/',
  }
  for (const output of [
    [],
    [{ secretKey: 'TOKEN', secretValue: '*not found*' }],
    [{ secretKey: 'OTHER', secretValue: 'private' }],
    [
      { secretKey: 'TOKEN', secretValue: 'one' },
      { secretKey: 'TOKEN', secretValue: 'two' },
    ],
  ]) {
    const invalid = new SecretReferences(undefined, async () => JSON.stringify(output))
    await expect(invalid.resolve(discovery({ TOKEN: reference }))).rejects.toThrow('Infisical')
    await invalid.close()
  }
  await resolver.close()
})

it('reads fresh TOTP codes on successive launches and closes pending work after refresh', async () => {
  let count = 0
  const resolver = new SecretReferences(undefined, async () => `${++count}\n`)
  const agent = discovery({ TOKEN: { provider: 'bitwarden', reference: 'item-id', field: 'totp' } })
  expect((await resolver.resolve(agent)).env?.TOKEN).toBe('1')
  expect((await resolver.resolve(agent)).env?.TOKEN).toBe('2')
  await resolver.close()
  const started = barrier<void>()
  const closing = new SecretReferences(undefined, async (_command, _args, signal) => {
    started.resolve()
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    )
    throw new Error('cancelled')
  })
  const read = closing
    .resolve(discovery({ TOKEN: { provider: 'onepassword', reference: 'op://vault/item/field' } }))
    .catch((error: unknown) => error)
  await started.promise
  closing.refresh()
  await closing.close()
  expect(await read).toBeInstanceOf(Error)
})

it('cancels an abandoned shared read only after its last reader leaves and waits for shutdown', async () => {
  const started = barrier<void>(),
    stopped = barrier<void>(),
    aborted = barrier<void>()
  let signal: AbortSignal | undefined
  const resolver = new SecretReferences(undefined, async (_command, _args, abort) => {
    signal = abort
    started.resolve()
    await new Promise<void>((resolve) =>
      abort.addEventListener(
        'abort',
        () => {
          aborted.resolve()
          resolve()
        },
        { once: true },
      ),
    )
    await stopped.promise
    throw new Error('cancelled')
  })
  const agent = discovery({
    TOKEN: { provider: 'onepassword', reference: 'op://work/service/password' },
  })
  const first = new AbortController(),
    second = new AbortController()
  const a = resolver.resolve(agent, first.signal).catch((error: unknown) => error)
  const b = resolver.resolve(agent, second.signal).catch((error: unknown) => error)
  await started.promise
  first.abort()
  await a
  expect(signal?.aborted).toBe(false)
  let finished = false
  void b.then(() => {
    finished = true
  })
  second.abort()
  await aborted.promise
  expect(signal?.aborted).toBe(true)
  expect(finished).toBe(false)
  stopped.resolve()
  await b
  expect(finished).toBe(true)
  await resolver.close()
})

it('bounds provider concurrency and prevents a pre-refresh completion replacing a newer value', async () => {
  let active = 0,
    maximum = 0
  const release = barrier<void>(),
    started = barrier<void>()
  const resolver = new SecretReferences(undefined, async () => {
    active++
    maximum = Math.max(maximum, active)
    if (active === 2) started.resolve()
    await release.promise
    active--
    return 'secret'
  })
  const work = resolver.resolve(
    discovery(
      Object.fromEntries(
        Array.from({ length: 6 }, (_, index) => [
          `TOKEN_${index}`,
          { provider: 'onepassword', reference: `op://vault/item/field${index}` },
        ]),
      ),
    ),
  )
  await started.promise
  expect(maximum).toBe(2)
  release.resolve()
  await work
  expect(maximum).toBe(2)
  await resolver.close()

  const old = barrier<string>(),
    newer = barrier<string>()
  let count = 0
  const rotating = new SecretReferences(undefined, async () =>
    ++count === 1 ? old.promise : newer.promise,
  )
  const agent = discovery({
    TOKEN: { provider: 'onepassword', reference: 'op://vault/item/field' },
  })
  const before = rotating.resolve(agent)
  rotating.refresh()
  const after = rotating.resolve(agent)
  newer.resolve('new')
  await after
  old.resolve('old')
  await before
  expect((await rotating.resolve(agent)).env?.TOKEN).toBe('new')
  await rotating.close()
})

it('redacts unconfirmed command shutdowns while retaining ownership until confirmation', async () => {
  const confirmation = barrier<void>()
  const resolver = new SecretReferences(
    () => ({}),
    async () => {
      throw new OwnedProcessShutdownError('private provider response', {
        confirmed: confirmation.promise,
      })
    },
  )
  const failed = resolver.resolve(
    discovery({ TOKEN: { provider: 'onepassword', reference: 'op://vault/item/secret' } }),
  )
  await expect(failed).rejects.toBeInstanceOf(OwnedProcessShutdownError)
  await expect(failed).rejects.toThrow('Secret provider shutdown was not confirmed')
  await expect(resolver.close()).rejects.toThrow('Secret provider shutdown was not confirmed')
  confirmation.resolve()
  await confirmation.promise
  await resolver.close()
})
