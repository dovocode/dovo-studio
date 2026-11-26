import { expect, it, vi } from 'vite-plus/test'
import { transcriptSourceIdentity } from './usage-transcript-source.js'

it('identifies shared mapped transcript directories without conflating hosts or providers', async () => {
  const registry = '\r\n    MachineGuid    REG_SZ    14fdac38-45cd-49a7-9988-6f29bd567aac\r\n'
  const root = 'C:\\Users\\Developer\\.claude\\projects'
  const windows = transcriptSourceIdentity('win32', false, async () => registry)
  const wsl = transcriptSourceIdentity('linux', true, async (command) =>
    command === 'wslpath' ? `c:${root.slice(2)}\r\n` : registry,
  )
  const source = await windows('claude', root)
  expect(source).toMatch(/^[a-f0-9]{64}$/)
  expect(await wsl('claude', '/mnt/c/Users/Developer/.claude/projects')).toBe(source)
  expect(await windows('codex', root)).not.toBe(source)
  expect(await windows('claude', `${root}2`)).not.toBe(source)
  const anotherMachine = transcriptSourceIdentity('win32', false, async () =>
    registry.replace('14fd', 'ff9d'),
  )
  expect(await anotherMachine('claude', root)).not.toBe(source)
  const localOnly = vi.fn<() => Promise<string>>(
    async () => '\\\\wsl.localhost\\Ubuntu\\home\\developer\\.claude',
  )
  expect(
    await transcriptSourceIdentity('linux', true, localOnly)('claude', '/home/developer/.claude'),
  ).toBeUndefined()
  expect(localOnly).toHaveBeenCalledOnce()
  expect(
    await transcriptSourceIdentity('win32', false, async () => '')('claude', root),
  ).toBeUndefined()
})
