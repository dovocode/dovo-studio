import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { mkdir, writeFile, utimes, rm, realpath, rename, truncate } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { Effect } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import {
  decode,
  codexSessionListSchema,
  codexSessionPreviewSchema,
  codexSessionImportResultSchema,
} from '@dovo/protocol'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../testing/integration'
import { parseCodexTranscript } from '../agents/providers/codex/session-transcript'
import * as sessionActivity from '../agents/providers/codex/session-activity'
import type { AgentAdapter } from '../agents/execution/types'

vi.setConfig(runtimeIntegration)
const realSessionActivity = sessionActivity.codexSessionActivity
beforeEach(() => {
  // Storage/admission tests must not depend on unrelated host exec/exit activity. The real
  // open-handle boundary is exercised separately below; unknown ownership has unit coverage.
  vi.spyOn(sessionActivity, 'codexSessionActivity').mockResolvedValue(
    ['linux', 'darwin'].includes(process.platform) ? 'inactive' : 'unknown',
  )
})
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})
const timestamp = '2026-10-01T10:00:00Z'
const row = (type: string, payload: unknown) => JSON.stringify({ type, timestamp, payload })
const sessionText = (id: string, cwd: string, extra: string[] = []) =>
  [
    row('session_meta', { id, cwd, source: 'cli', originator: 'codex_cli_rs' }),
    row('event_msg', { type: 'task_started', turn_id: 'turn-1' }),
    row('turn_context', { model: 'gpt-6-sol', effort: 'high' }),
    row('response_item', {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Historical request' }],
    }),
    row('event_msg', { type: 'user_message', message: 'Historical request' }),
    row('response_item', {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Historical reply' }],
    }),
    row('event_msg', { type: 'task_complete' }),
    ...extra,
    '',
  ].join('\n')

async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  f.directory = await realpath(f.directory)
  const home = join(f.directory, 'custom-codex')
  const directory = join(home, 'sessions', '2026', '10', '01')
  await mkdir(directory, { recursive: true })
  const token = 'codex-import-owner-token-with-enough-characters'
  const options = { port: 0, databasePath: join(f.directory, 'runtime.sqlite'), ownerToken: token }
  let runtime = await startRuntime(options)
  cleanups.push(() => runtime.close())
  f.workspace.agents[0] = {
    ...f.workspace.agents[0]!,
    model: 'configured-model',
    env: { CODEX_HOME: home, EXAMPLE_SETTING: 'keep-me' },
    args: ['-c', 'model_provider="openai"'],
  }
  runtime.services.store.update(() => f.workspace)
  const transcript = async (id: string, cwd = f.directory, text = sessionText(id, cwd)) => {
    const path = join(directory, `rollout-${id}.jsonl`)
    await writeFile(path, text)
    await utimes(path, new Date(timestamp), new Date(timestamp))
    return path
  }
  const request = (operation: string, input: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/tasks/${operation}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const input = { repositoryId: 'repo', agentId: 'agent' }
  const list = async () =>
    decode(codexSessionListSchema, await (await request('codex-sessions/list', input)).json())
  const preview = async (key: string) =>
    decode(
      codexSessionPreviewSchema,
      await (await request('codex-sessions/preview', { ...input, key })).json(),
    )
  const importSession = async (key: string, revision: string) => {
    const response = await request('codex-sessions/import', { ...input, key, revision })
    expect(response.status).toBe(200)
    return decode(codexSessionImportResultSchema, await response.json())
  }
  return {
    ...f,
    home,
    transcript,
    request,
    list,
    preview,
    importSession,
    input,
    get runtime() {
      return runtime
    },
    restart: async () => {
      await runtime.close()
      runtime = await startRuntime(options)
    },
  }
}

it('discovers only project terminal sessions in the configured Codex home, authenticates reads, and deduplicates transcript formats', async () => {
  const f = await setup()
  await f.transcript('cli-session')
  await f.transcript('unrelated-session', '/another/project')
  await f.transcript(
    'native-child',
    f.directory,
    sessionText('native-child', f.directory).replace(
      '"source":"cli"',
      '"source":{"subagent":{"thread_spawn":{}}}',
    ),
  )
  await f.transcript(
    'dovo-session',
    f.directory,
    sessionText('dovo-session', f.directory).replace('codex_cli_rs', 'dovo_studio'),
  )
  expect((await f.request('codex-sessions/list', f.input, 'invalid')).status).toBe(401)
  expect((await f.list()).sessions.map((session) => session.sessionId)).toEqual(['cli-session'])
  const candidate = (await f.list()).sessions[0]!
  const preview = await f.preview(candidate.key)
  expect(preview.status).toBe(
    ['linux', 'darwin'].includes(process.platform) ? 'available' : 'unknown',
  )
  expect(preview.messages.map((message) => [message.role, message.text])).toEqual([
    ['user', 'Historical request'],
    ['assistant', 'Historical reply'],
  ])
  expect(preview.session.model).toBe('gpt-6-sol')
  expect(
    (await f.request('codex-sessions/preview', { ...f.input, key: '../../outside' })).status,
  ).toBe(404)
  f.runtime.services.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({
      ...agent,
      configDirectory: f.home,
      env: { CODEX_HOME: '/wrong-home' },
    })),
  }))
  expect((await f.list()).sessions).toHaveLength(1)
  await rename(f.home, join(f.directory, '.codex'))
  f.runtime.services.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({
      ...agent,
      configDirectory: undefined,
      env: { [process.platform === 'win32' ? 'USERPROFILE' : 'HOME']: f.directory },
    })),
  }))
  expect((await f.list()).sessions).toHaveLength(1)
})

it('bounds discovery and refuses oversized transcript previews', async () => {
  const f = await setup()
  await Promise.all(
    Array.from({ length: 401 }, (_, index) =>
      f.transcript(`bounded-${String(index).padStart(3, '0')}`),
    ),
  )
  const list = await f.list()
  expect(list.sessions).toHaveLength(400)
  expect(list.notice).toContain('Discovery is bounded')
  const path = await f.transcript('z-oversized')
  await truncate(path, 16 * 1024 * 1024 + 1)
  const oversized = (await f.list()).sessions.find(
    (session) => session.sessionId === 'z-oversized',
  )!
  expect(
    (await f.request('codex-sessions/preview', { ...f.input, key: oversized.key })).status,
  ).toBe(413)
})

it.skipIf(!['linux', 'darwin'].includes(process.platform))(
  'bounds previews while saving the complete consumed history',
  async () => {
    const f = await setup()
    await f.transcript(
      'long-session',
      f.directory,
      sessionText(
        'long-session',
        f.directory,
        Array.from({ length: 120 }, (_, index) =>
          row('event_msg', { type: 'user_message', message: `Old prompt ${index}` }),
        ),
      ),
    )
    const candidate = (await f.list()).sessions[0]!
    const preview = await f.preview(candidate.key)
    expect(preview.messages).toHaveLength(100)
    expect(preview.olderMessages).toBe(22)
    const { id } = await f.importSession(candidate.key, preview.revision)
    const imported = f.runtime.services.store.task(id)
    expect(imported.messages).toHaveLength(122)
    expect(imported.consumedMessageIds).toHaveLength(122)
    await expect(f.runtime.services.tasks.start(id)).rejects.toThrow('Send a new message')
  },
)

it.skipIf(!['linux', 'darwin'].includes(process.platform))(
  'imports atomically and idempotently across concurrent requests and restart without replaying historical prompts',
  async () => {
    const f = await setup()
    const cwd = join(f.directory, 'nested')
    await mkdir(cwd)
    const path = await f.transcript(
      'resume-session',
      cwd,
      sessionText('resume-session', cwd, [
        row('event_msg', { type: 'task_started' }),
        row('event_msg', { type: 'user_message', message: 'Unfinished historical prompt' }),
      ]),
    )
    const candidate = (await f.list()).sessions[0]!
    const preview = await f.preview(candidate.key)
    expect(preview.notice).toContain('ended during a turn')
    const results = await Promise.all([
      f.importSession(candidate.key, preview.revision),
      f.importSession(candidate.key, preview.revision),
    ])
    expect(new Set(results.map((result) => result.id)).size).toBe(1)
    const id = results[0]!.id
    const saved = f.runtime.services.store.task(id)
    expect(saved).toMatchObject({
      status: 'review',
      sessionId: 'resume-session',
      queuePaused: true,
      importedCodexSession: { cwd, home: f.home },
    })
    expect(saved.consumedMessageIds).toEqual(saved.messages.map((message) => message.id))
    expect(saved.harness).toMatchObject({
      model: 'gpt-6-sol',
      reasoning: 'high',
      configDirectory: f.home,
      env: { EXAMPLE_SETTING: 'keep-me' },
      args: ['-c', 'model_provider="openai"'],
    })
    await expect(f.runtime.services.tasks.start(id)).rejects.toThrow('Send a new message')
    await f.runtime.services.tasks.runScheduled()
    expect(f.runtime.services.store.task(id).activeRunId).toBeUndefined()
    await f.restart()
    expect(await f.importSession(candidate.key, preview.revision)).toEqual({ id, existing: true })
    expect(await f.runtime.services.checkouts.directory(id)).toBe(cwd)
    expect(await f.runtime.services.checkouts.fileDirectory(id)).toBe(cwd)
    const run = vi.fn<AgentAdapter['run']>(async (input) => {
      input.onSession('resume-session')
      input.onPromptAccepted?.()
      input.onText('New reply')
    })
    vi.spyOn(f.runtime.services.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run,
    })
    expect(
      (
        await f.request('message', {
          id,
          messageId: 'new-input',
          text: 'Explicit new request',
          attachmentIds: [],
        })
      ).status,
    ).toBe(200)
    await waitForRuntime(() => expect(run).toHaveBeenCalledTimes(1))
    await waitForRuntime(() =>
      expect(f.runtime.services.store.task(id).activeRunId).toBeUndefined(),
    )
    expect(run.mock.calls[0]?.[0]).toMatchObject({ cwd, sessionId: 'resume-session' })
    expect(run.mock.calls[0]?.[0].prompt).toContain('Explicit new request')
    expect(run.mock.calls[0]?.[0].prompt).not.toContain('Historical request')
    expect(run.mock.calls[0]?.[0].prompt).not.toContain('Unfinished historical prompt')
    expect(
      f.runtime.services.store
        .task(id)
        .messages.find((message) => message.text === 'Unfinished historical prompt')?.turnId,
    ).toBeUndefined()
    // Changing model starts a new provider context but still must never resend imported prompts.
    f.runtime.services.store.updateTask(id, (task) => ({
      ...task,
      agentOverrides: { model: 'different-model' },
    }))
    expect(
      (
        await f.request('message', {
          id,
          messageId: 'second-input',
          text: 'Second explicit request',
          attachmentIds: [],
        })
      ).status,
    ).toBe(200)
    await waitForRuntime(() => expect(run).toHaveBeenCalledTimes(2))
    await waitForRuntime(() =>
      expect(f.runtime.services.store.task(id).activeRunId).toBeUndefined(),
    )
    expect(run.mock.calls[1]?.[0].prompt).not.toContain('Historical request')
    expect(run.mock.calls[1]?.[0].prompt).not.toContain('Unfinished historical prompt')
    // A lost-response retry remains a receipt even if the original transcript was removed.
    await rm(path)
    expect(await f.importSession(candidate.key, preview.revision)).toEqual({ id, existing: true })
  },
)

it('blocks missing paths, changed previews and sessions already owned by Dovo', async () => {
  const f = await setup()
  const path = await f.transcript('existing-session')
  const candidate = (await f.list()).sessions[0]!
  const preview = await f.preview(candidate.key)
  await writeFile(
    path,
    sessionText('existing-session', f.directory, [
      row('event_msg', { type: 'user_message', message: 'Changed' }),
    ]),
  )
  await utimes(path, new Date(timestamp), new Date(timestamp))
  expect(
    (
      await f.request('codex-sessions/import', {
        ...f.input,
        key: candidate.key,
        revision: preview.revision,
      })
    ).status,
  ).toBe(409)
  const owner = f.runtime.services.tasks.create({
    title: 'Native owner',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  f.runtime.services.store.updateTask(owner.id, (task) => ({
    ...task,
    sessionId: 'existing-session',
  }))
  expect(await f.preview(candidate.key)).toMatchObject({
    status: 'owned',
    session: { taskId: owner.id },
  })
  const ownedPreview = await f.preview(candidate.key)
  expect(
    (
      await f.request('codex-sessions/import', {
        ...f.input,
        key: candidate.key,
        revision: ownedPreview.revision,
      })
    ).status,
  ).toBe(409)
  const missingCwd = join(f.directory, 'missing-checkout')
  await f.transcript('missing-checkout-session', missingCwd)
  const missing = (await f.list()).sessions.find(
    (session) => session.sessionId === 'missing-checkout-session',
  )!
  const absent = await f.preview(missing.key)
  expect(absent.status).toBe('missing-checkout')
  expect(
    (
      await f.request('codex-sessions/import', {
        ...f.input,
        key: missing.key,
        revision: absent.revision,
      })
    ).status,
  ).toBe(409)
  await rm(path)
  expect(
    (await f.request('codex-sessions/preview', { ...f.input, key: candidate.key })).status,
  ).toBe(404)
})

it.skipIf(!['linux', 'darwin'].includes(process.platform))(
  'finds registered project worktrees and retains their exact nested checkout after restart',
  async () => {
    const f = await setup()
    const worktree = `${f.directory}-worktree`
    cleanups.push(() => rm(worktree, { recursive: true, force: true }))
    await f.runtime.services.git.command(f.directory, [
      'worktree',
      'add',
      '--detach',
      worktree,
      'HEAD',
    ])
    const cwd = join(worktree, 'nested')
    await mkdir(cwd)
    await f.transcript('worktree-session', cwd)
    const candidate = (await f.list()).sessions[0]!
    const preview = await f.preview(candidate.key)
    const { id } = await f.importSession(candidate.key, preview.revision)
    await f.restart()
    expect(f.runtime.services.store.task(id)).toMatchObject({
      execution: 'worktree',
      existingWorktreePath: worktree,
    })
    expect(await f.runtime.services.checkouts.directory(id)).toBe(cwd)
    const sibling = await f.runtime.services.tasks.newWorktreeThread(id, 'reuse')
    expect(await f.runtime.services.checkouts.directory(sibling.id)).toBe(worktree)
    expect(f.runtime.services.store.task(sibling.id).importedCodexSession).toBeUndefined()
    await rm(cwd, { recursive: true })
    f.runtime.services.tasks.queue.add(id, 'new', 'New explicit prompt')
    await expect(f.runtime.services.tasks.start(id)).rejects.toThrow('checkout is missing')
  },
)

it.skipIf(!['linux', 'darwin'].includes(process.platform))(
  'never steals a live native process, including idle sessions with an old transcript',
  async () => {
    vi.spyOn(sessionActivity, 'codexSessionActivity').mockImplementation(realSessionActivity)
    const f = await setup()
    const path = await f.transcript('live-session')
    const child = spawn(
      process.execPath,
      [
        '-e',
        'require("node:fs").openSync(process.argv[1], "r+"); process.stdout.write("ready"); setInterval(() => {}, 1000)',
        path,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    cleanups.push(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill()
        await once(child, 'exit')
      }
    })
    await once(child.stdout, 'data')
    const candidate = (await f.list()).sessions[0]!
    const preview = await f.preview(candidate.key)
    expect(preview.status).toBe('active')
    expect(
      (
        await f.request('codex-sessions/import', {
          ...f.input,
          key: candidate.key,
          revision: preview.revision,
        })
      ).status,
    ).toBe(409)
    child.kill()
    await once(child, 'exit')
    // The controlled owner has exited; unrelated host permission transitions are outside this test.
    vi.spyOn(sessionActivity, 'codexSessionActivity').mockResolvedValue('inactive')
    const inactive = await f.preview(candidate.key)
    expect(inactive.status).toBe('available')
    const { id } = await f.importSession(candidate.key, inactive.revision)
    const reopened = spawn(
      process.execPath,
      [
        '-e',
        'require("node:fs").openSync(process.argv[1], "r+"); process.stdout.write("ready"); setInterval(() => {}, 1000)',
        path,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    cleanups.push(async () => {
      if (reopened.exitCode === null && reopened.signalCode === null) {
        reopened.kill()
        await once(reopened, 'exit')
      }
    })
    await once(reopened.stdout, 'data')
    vi.spyOn(sessionActivity, 'codexSessionActivity').mockImplementation(realSessionActivity)
    f.runtime.services.tasks.queue.add(id, 'reopened', 'New prompt')
    await expect(f.runtime.services.tasks.start(id)).rejects.toThrow('open in another process')
    reopened.kill()
    await once(reopened, 'exit')
    await rm(path)
    f.runtime.services.tasks.queue.add(id, 'fresh', 'New prompt')
    await expect(f.runtime.services.tasks.start(id)).rejects.toThrow('transcript is missing')
  },
)

it.skipIf(!['linux', 'darwin'].includes(process.platform))(
  'shares checkout admission for imported subfolders, native runs and explicit edits',
  async () => {
    const f = await setup()
    const cwd = join(f.directory, 'nested')
    await mkdir(cwd)
    await f.transcript('nested-session', cwd)
    const candidate = (await f.list()).sessions[0]!
    const preview = await f.preview(candidate.key)
    const { id } = await f.importSession(candidate.key, preview.revision)
    f.runtime.services.store.updateTaskHistory(id, (task) => ({
      ...task,
      messages: [
        ...task.messages,
        { id: 'continue-nested', role: 'user', text: 'Continue explicitly' },
      ],
    }))
    const main = f.runtime.services.tasks.create({
      title: 'Main checkout',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Work',
      execution: 'main',
    })
    let finish: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      finish = resolve
    })
    const run = vi.fn<AgentAdapter['run']>(async () => {
      await held
    })
    vi.spyOn(f.runtime.services.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run,
    })
    const first = await f.runtime.services.tasks.start(main.id)
    try {
      await waitForRuntime(() => expect(run).toHaveBeenCalledTimes(1))
      await expect(f.runtime.services.tasks.start(id)).rejects.toMatchObject({ status: 409 })
      expect(run).toHaveBeenCalledTimes(1)
    } finally {
      finish()
      await first.done
    }

    const secondHeld = new Promise<void>((resolve) => {
      finish = resolve
    })
    run.mockImplementation(async (input) => {
      expect(input.cwd).toBe(cwd)
      await secondHeld
    })
    const imported = await f.runtime.services.tasks.start(id)
    try {
      await waitForRuntime(() => expect(run).toHaveBeenCalledTimes(2))
      await expect(
        f.runtime.services.tasks.withCheckoutMutation(f.directory, async () => {}),
      ).rejects.toMatchObject({ status: 409 })
      f.runtime.services.store.updateTaskHistory(main.id, (task) => ({
        ...task,
        messages: [...task.messages, { id: 'continue-main', role: 'user', text: 'Continue main' }],
      }))
      await expect(f.runtime.services.tasks.start(main.id)).rejects.toMatchObject({ status: 409 })
      expect(run).toHaveBeenCalledTimes(2)
    } finally {
      finish()
      await imported.done
    }
    await runClientEffect(
      f.runtime.services.tasks.withCheckoutEditEffect(
        cwd,
        Effect.promise(async () => {
          await expect(
            f.runtime.services.tasks.withCheckoutMutation(f.directory, async () => {}),
          ).rejects.toMatchObject({ status: 409 })
        }),
      ),
    )
    await f.runtime.services.tasks.withCheckoutMutation(f.directory, async () => {
      await expect(
        runClientEffect(f.runtime.services.tasks.withCheckoutEditEffect(cwd, Effect.void)),
      ).rejects.toMatchObject({ status: 409 })
    })
  },
)

it('deduplicates both transcript user encodings while retaining repeated real prompts', () => {
  const repeated = sessionText('duplicate-session', '/project', [
    row('event_msg', { type: 'task_started' }),
    row('event_msg', { type: 'user_message', message: 'Historical request' }),
    row('response_item', {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Historical request' }],
    }),
  ])
  expect(parseCodexTranscript(repeated).messages.map((message) => message.text)).toEqual([
    'Historical request',
    'Historical reply',
    'Historical request',
  ])
})
