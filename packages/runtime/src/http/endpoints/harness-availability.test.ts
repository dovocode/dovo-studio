import { expect, it, vi } from 'vite-plus/test'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { startRuntime } from '../../index.js'
import {
  defaultTaskHarness,
  decode,
  harnessAvailabilitySchema,
  type Agent,
  type ProviderStatus,
} from '@dovo/protocol'

it.skipIf(process.platform === 'win32')(
  'finds a CLI installed after startup through Check provider',
  async () => {
    const token = randomBytes(32).toString('base64url')
    const directory = await mkdtemp(join(tmpdir(), 'dovo-provider-path-'))
    const original = process.env.PATH
    const command = `acp-${randomBytes(8).toString('hex')}`
    let installed = false
    const refreshProviderPath = vi.fn<() => Promise<void>>(async () => {
      if (installed) process.env.PATH = [directory, original].join(delimiter)
    })
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: token,
      port: 0,
      refreshProviderPath,
    })
    try {
      const agent = {
        ...defaultTaskHarness('acp'),
        id: 'custom-acp',
        name: 'Custom ACP',
        endpoint: command,
      }
      runtime.services.store.update((workspace) => ({ ...workspace, agents: [agent] }))
      const check = async () => {
        const response = await fetch(`http://127.0.0.1:${runtime.port}/api/agents/probe`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: agent.id }),
        })
        expect(response.status).toBe(200)
        return response.json()
      }
      expect(await check()).toMatchObject({ available: false })
      await writeFile(join(directory, command), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
      installed = true
      expect(await check()).toMatchObject({ available: true })
      expect(refreshProviderPath).toHaveBeenCalledTimes(2)
    } finally {
      if (original === undefined) delete process.env.PATH
      else process.env.PATH = original
      await runtime.close()
      await rm(directory, { recursive: true, force: true })
    }
  },
)

it('probes configured providers independently, authenticates, caches and never exposes credentials', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const base = await runtime.services.agents.get('codex')
  const probe = vi.fn<(agent: Agent) => Promise<ProviderStatus>>(async (agent) => {
    const configured = runtime.services.agents.configure(agent)
    if (agent.provider === 'muse') throw new Error('private credential')
    return {
      provider: agent.provider,
      available: configured.endpoint === '/custom/codex' || agent.provider === 'claude',
      detail: 'private credential',
    }
  })
  const get = vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({ ...base, probe })
  try {
    runtime.services.store.update((workspace) => ({
      ...workspace,
      agents: [
        {
          ...defaultTaskHarness('codex'),
          id: 'custom',
          name: 'Custom',
          endpoint: '/custom/codex',
          env: { SECRET: 'private credential' },
        },
      ],
    }))
    const call = (credential = token) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/agents/availability`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    expect((await call('invalid')).status).toBe(401)
    expect(probe).not.toHaveBeenCalled()
    const response = await call()
    expect(response.status).toBe(200)
    const entries = decode(harnessAvailabilitySchema, await response.json())
    expect(entries.filter((entry) => entry.available).map((entry) => entry.id)).toEqual([
      'harness:claude',
      'agent:custom',
      'agent:dovo:claude',
    ])
    expect(JSON.stringify(entries)).not.toContain('private credential')
    const calls = probe.mock.calls.length
    const unavailableCalls = probe.mock.calls.filter(
      ([agent]) =>
        agent.provider !== 'claude' &&
        runtime.services.agents.configure(agent).endpoint !== '/custom/codex',
    ).length
    await call()
    expect(probe).toHaveBeenCalledTimes(calls + unavailableCalls)
    runtime.services.commands.save({ ...runtime.services.commands.get(), codex: '/custom/codex' })
    const changed = decode(harnessAvailabilitySchema, await (await call()).json())
    expect(changed.find((entry) => entry.id === 'harness:codex')?.available).toBe(true)
    expect(probe).toHaveBeenCalledTimes(calls + unavailableCalls * 2)
  } finally {
    get.mockRestore()
    await runtime.close()
  }
})
