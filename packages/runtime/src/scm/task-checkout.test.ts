import { afterEach, expect, it, vi } from 'vitest'
import { writeFile, readFile, mkdir, realpath, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import type { AgentRun } from '../agents/types'
import { responses } from '@dovo/protocol'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
it('keeps agents, terminals, review edits, commits and gh inside the selected task checkout', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const ownerToken = 'checkout-test-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  // Test checkout routing without the developer's interactive login shell/plugins.
  s.commands.save({ ...s.commands.get(), shell: '/bin/sh', shellArgs: [] })
  s.store.update(() => f.workspace)
  const call = async (path: string, input: unknown) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const result: unknown = await response.json()
    if (!response.ok) throw new Error(JSON.stringify(result))
    return result
  }
  const main = s.tasks.create({
    title: 'Main',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Work here',
  })
  const isolated = s.tasks.create({
    title: 'Isolated',
    agentId: 'agent',
    repositoryId: 'repo',
    execution: 'worktree',
    objective: 'Work separately',
  })
  const [cwd, same] = await Promise.all([
    s.checkouts.directory(isolated.id),
    s.checkouts.directory(isolated.id),
  ])
  cleanups.push(() => rm(dirname(cwd), { recursive: true, force: true }))
  expect(cwd).toBe(same)
  expect(cwd).not.toBe(f.directory)
  expect(await s.checkouts.directory(main.id)).toBe(await realpath(f.directory))
  const runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run: async (run) => {
      runs.push(run)
      await writeFile(join(run.cwd, 'hello.txt'), 'agent change\n')
    },
  })
  await (
    await s.tasks.start(isolated.id)
  ).done
  expect(runs[0].cwd).toBe(cwd)
  expect(runs[0].agent.instructions).toContain('Use gh for GitHub operations')
  expect(s.store.task(isolated.id).files[0].after).toBe('agent change\n')
  const scope = { repositoryId: 'repo', taskId: isolated.id }
  await call('/api/scm/apply', {
    ...scope,
    path: 'hello.txt',
    expected: 'agent change\n',
    contents: 'review edit\n',
  })
  const files = responses.files.parse(await call('/api/scm/changes', scope)).files
  expect(files[0].after).toBe('review edit\n')
  await call('/api/scm/stage', { ...scope, paths: ['hello.txt'] })
  await call('/api/scm/commit', { ...scope, message: 'Task worktree change' })
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('original\n')
  expect((await s.git.command(f.directory, ['log', '-1', '--format=%s'])).trim()).toBe(
    'Initial fixture',
  )
  expect((await s.git.command(cwd, ['log', '-1', '--format=%s'])).trim()).toBe(
    'Task worktree change',
  )
  const terminal = responses.terminal.parse(await call('/api/terminals', { taskId: isolated.id }))
  s.terminals.input(terminal.id, 'printf \'CHECKOUT:%s:END\\n\' "$PWD"\r')
  await vi.waitFor(() =>
    expect(s.terminals.get(terminal.id).buffer).toContain(`CHECKOUT:${cwd}:END`),
  )
  s.terminals.close(terminal.id)
  const bin = join(f.directory, '.git', 'fake-bin')
  await mkdir(bin)
  await writeFile(
    join(bin, 'gh'),
    '#!/bin/sh\nif [ -n "$GH_REPO" ]; then exit 9; fi\nprintf \'[{"number":1,"title":"%s","url":"https://github.com/test/project/pull/1","state":"OPEN","headRefName":"task"}]\' "$PWD"\n',
    { mode: 0o755 },
  )
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
  vi.stubEnv('GH_REPO', 'wrong/project')
  vi.stubEnv('GIT_DIR', '/missing/wrong-project')
  expect(responses.pulls.parse(await call('/api/scm/pulls', scope)).pulls[0].title).toBe(cwd)
  expect(await s.checkouts.directory(isolated.id)).toBe(cwd)
})
