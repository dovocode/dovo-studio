import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { GitService } from '../git/git.js'
import { verifiedGitUpdates } from './external-git-updates.js'
import { startRuntime } from '../../index.js'
import { WorkspaceStore } from '../../storage/workspace.js'
import { fixture as workspaceFixture } from '../../testing/fixture.js'
import type { AgentAdapter } from '../../agents/execution/types.js'

const execute = promisify(execFile)
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dovo-push-evidence-')))
  directories.push(root)
  const external = join(root, 'external checkout')
  const bare = join(root, 'remote.git')
  const transport = join(root, 'ssh')
  await mkdir(external)
  await writeFile(transport, '#!/bin/sh\nexec git-receive-pack "$DOVO_TEST_BARE"\n', {
    mode: 0o755,
  })
  const git = new GitService()
  const command = (args: string[]) =>
    execute('git', args, {
      cwd: external,
      env: {
        ...process.env,
        GIT_SSH_COMMAND: transport,
        GIT_SSH_VARIANT: 'ssh',
        DOVO_TEST_BARE: bare,
      },
    })
  await command(['init', '--bare', bare])
  await command(['init', '-b', 'topic'])
  await command(['config', 'user.email', 'test@example.com'])
  await command(['config', 'user.name', 'Test'])
  await command(['config', 'commit.gpgSign', 'false'])
  await command(['remote', 'add', 'origin', 'git@github.com:team/external.git'])
  const commit = async (message: string) => command(['commit', '--allow-empty', '-m', message])
  const head = async () => (await command(['rev-parse', 'HEAD'])).stdout.trim()
  const observe = (input: string, output: unknown, cwd?: string, status = 'completed') =>
    verifiedGitUpdates(git, 'turn', root, {
      id: 'tool',
      name: 'bash',
      kind: 'command',
      status,
      input,
      output,
      cwd,
    })
  const receipt = async () => ({
    branch: 'topic',
    sha: await head(),
    repositoryIdentity: 'github.com/team/external',
    cwd: external,
    turnId: 'turn',
  })
  return { command, commit, receipt, observe, external }
}

it('checks porcelain and standard push reports against real Git refs and the configured destination', async () => {
  const { command, commit, receipt, observe, external } = await fixture()
  await commit('first')
  const created = await command(['push', '--porcelain', '-u', 'origin', 'HEAD'])
  await expect(
    observe(`git -C "${external}" push --porcelain -u origin HEAD`, created),
  ).resolves.toMatchObject([await receipt()])

  await commit('second')
  const updated = await command(['push', 'origin', 'HEAD:topic'])
  await expect(observe('git push origin HEAD:topic', updated, external)).resolves.toMatchObject([
    await receipt(),
  ])
  await expect(observe('git push origin HEAD:topic', updated, external, 'failed')).resolves.toEqual(
    [],
  )
  await expect(
    observe(
      'git push origin HEAD:topic',
      updated.stderr.replace('team/external', 'team/other'),
      external,
    ),
  ).resolves.toEqual([])

  await commit('third')
  await expect(observe('git push origin HEAD:topic', updated, external)).resolves.toEqual([])
})

it('records a completed commit but skips ambiguous destinations, no-op pushes and branch deletions', async () => {
  const { command, commit, receipt, observe, external } = await fixture()
  const created = await commit('first')
  await expect(
    observe(`cd "${external}" && git commit --allow-empty -m first`, created),
  ).resolves.toMatchObject([await receipt()])
  await command(['remote', 'add', 'other', 'git@github.com:other/external.git'])
  await expect(observe('git commit --allow-empty -m first', created, external)).resolves.toEqual([])
  await command(['remote', 'remove', 'other'])

  const firstPush = await command(['push', '--porcelain', '-u', 'origin', 'HEAD'])
  await expect(observe('git push --dry-run', firstPush, external)).resolves.toEqual([])
  await expect(observe('git push -un origin HEAD', firstPush, external)).resolves.toEqual([])
  await expect(observe('echo fake && git push', firstPush, external)).resolves.toEqual([])
  const noop = await command(['push', '--porcelain', 'origin', 'HEAD'])
  await expect(observe('git push --porcelain origin HEAD', noop, external)).resolves.toEqual([])
  const deleted = await command(['push', 'origin', ':topic'])
  await expect(observe('git push origin :topic', deleted, external)).resolves.toEqual([])
})

it('saves a provider push for its own thread through store reopen and keeps it out of public history', async () => {
  const { command, commit, receipt, external } = await fixture()
  await commit('first')
  const workspace = await workspaceFixture()
  try {
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: 'push-evidence-owner-token-at-least-32-characters',
      port: 0,
    })
    try {
      const services = runtime.services
      services.store.update(() => workspace.workspace)
      services.preferences.save({
        enablePullRequestWatching: true,
        enablePullRequestBabysitting: true,
      })
      const task = services.tasks.create({
        title: 'External push',
        repositoryId: 'repo',
        agentId: 'agent',
        objective: 'Push topic',
      })
      vi.spyOn(services.agents, 'get').mockResolvedValue({
        probe: vi.fn<AgentAdapter['probe']>(),
        run: async (run) => {
          run.onSession('external-push')
          run.onEvent?.('item/started', {
            item: {
              id: 'push',
              type: 'commandExecution',
              cwd: external,
              command: 'git push -u origin HEAD',
            },
          })
          const result = await command(['push', '-u', 'origin', 'HEAD'])
          run.onEvent?.('item/completed', {
            item: {
              id: 'push',
              type: 'commandExecution',
              exitCode: 0,
              status: 'completed',
              result,
            },
          })
          run.onText('Done')
        },
      })
      await (
        await services.tasks.start(task.id)
      ).done
      const expected = await receipt()
      const [{ id: turnId } = { id: '' }] = services.store.task(task.id).turns ?? []
      expect(services.store.externalGitReceipts(task.id)).toMatchObject([{ ...expected, turnId }])
      const reopened = new WorkspaceStore(services.db)
      expect(reopened.externalGitReceipts(task.id)).toMatchObject([{ ...expected, turnId }])
      expect(reopened.externalGitReceipts('another-task')).toEqual([])
      expect(reopened.publicWorkspace().tasks.find(({ id }) => id === task.id)).not.toHaveProperty(
        'externalGitReceipts',
      )
    } finally {
      await runtime.close()
    }
  } finally {
    await workspace.cleanup()
  }
})
