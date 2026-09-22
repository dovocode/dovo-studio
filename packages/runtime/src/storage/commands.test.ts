import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandsSchema } from '@dovo/protocol'
import { openDatabase } from './database'
import { Commands } from './commands'
import { GitService } from '../scm/git'
import { AgentRegistry } from '../agents/registry'
import { Terminals } from '../terminal/terminals'
import { defaultShell } from '../terminal/shell'
afterEach(() => vi.unstubAllEnvs())
it('persists command defaults and validates executable paths', () => {
  const db = openDatabase(':memory:')
  try {
    const commands = new Commands(db)
    expect(commands.get()).toMatchObject({
      git: 'git',
      gh: 'gh',
      codex: 'codex',
      shell: '',
      shellArgs: ['-l'],
    })
    commands.save({
      ...commands.get(),
      shell: '/bin/bash',
      shellArgs: ['--noprofile', '--norc'],
      git: '/path with spaces/git',
    })
    expect(new Commands(db).get()).toEqual(commands.get())
    expect(() => commands.save({ ...commands.get(), git: 'git\nother' })).toThrow(
      'Enter one executable',
    )
    vi.stubEnv('SHELL', '/bin/bash')
    expect(defaultShell()).toBe('/bin/bash')
    vi.stubEnv('SHELL', '/missing/fish')
    expect(defaultShell()).toMatch(/\/bin\/(zsh|bash)$/)
  } finally {
    db.close()
  }
})
it('uses configured Git and gh executables literally in the supplied cwd', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-cli-test-'))
  try {
    const git = join(directory, 'custom git'),
      gh = join(directory, 'custom gh')
    await writeFile(git, '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@"\n', { mode: 0o755 })
    await writeFile(
      gh,
      '#!/bin/sh\nprintf \'[{"number":1,"title":"Configured gh","url":"https://github.com/test/repo/pull/1","state":"OPEN","headRefName":"test"}]\'\n',
      { mode: 0o755 },
    )
    const service = new GitService(() => commandsSchema.parse({ git, gh }))
    expect(await service.command(directory, ['literal;argument'])).toContain('literal;argument')
    vi.spyOn(service, 'inspect').mockResolvedValue({ path: directory, branch: 'main' })
    expect((await service.pullRequests(directory))[0].title).toBe('Configured gh')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it('keeps explicit agent overrides and leaves OpenCode server URLs independent', async () => {
  const registry = new AgentRegistry(() =>
    commandsSchema.parse({ codex: '/custom/codex', claude: '/custom/claude', acp: '/custom/acp' }),
  )
  try {
    expect(registry.configure({ provider: 'codex', endpoint: '', model: '' }).endpoint).toBe(
      '/custom/codex',
    )
    expect(
      registry.configure({ provider: 'claude', endpoint: '/agent/claude', model: '' }).endpoint,
    ).toBe('/agent/claude')
    expect(
      registry.configure({ provider: 'acp', endpoint: '', model: '', args: ['acp'] }),
    ).toMatchObject({ endpoint: '/custom/acp', args: ['acp'] })
    expect(registry.configure({ provider: 'opencode', endpoint: '', model: '' }).endpoint).toBe('')
  } finally {
    await registry.dispose()
  }
})
it('runs new terminals with the configured shell and arguments', async () => {
  const terminals = new Terminals(() =>
    commandsSchema.parse({ shell: '/bin/bash', shellArgs: ['--noprofile', '--norc'] }),
  )
  try {
    const terminal = terminals.create('test', tmpdir())
    terminals.input(terminal.id, 'printf \'BASH_CONFIG:%s:END\\n\' "$BASH_VERSION"\r')
    await vi.waitFor(() =>
      expect(terminals.get(terminal.id).buffer).toMatch(/BASH_CONFIG:[0-9][^\r\n]+:END/),
    )
  } finally {
    terminals.dispose()
  }
})
