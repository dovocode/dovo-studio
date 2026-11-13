import { afterEach, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SCRATCH_PROJECT_ID, defaultTaskHarness, type Task } from '@dovo/protocol'
import { startRuntime } from '../index.js'
import type { AgentAdapter } from '../agents/execution/types.js'
import { runtimeIntegration } from './integration.js'

// A real runtime (HTTP, SQLite, task queue, MCP bridge) with a scripted agent adapter.
vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
export const botTestToken = 'bots-owner-token-at-least-32-characters-long'

export type BotRunInput = Parameters<AgentAdapter['run']>[0]

export async function setupBotRuntime() {
  const root = await mkdtemp(join(tmpdir(), 'dovo-bots-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const databasePath = join(root, 'runtime.sqlite')
  const prompts: string[] = []
  const inputs: BotRunInput[] = []
  let runtime = await start()
  async function start() {
    const started = await startRuntime({ databasePath, ownerToken: botTestToken, port: 0 })
    const run = vi.fn<AgentAdapter['run']>(async (input) => {
      prompts.push(input.agent.instructions)
      input.onSession('provider-session')
      input.onText('Done')
    })
    vi.spyOn(started.services.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: (input) => {
        inputs.push(input)
        return run(input)
      },
    })
    return Object.assign(started, { run })
  }
  cleanups.push(() => runtime.close())
  const request = (
    path: string,
    input?: unknown,
    method = 'POST',
    mutationId?: string,
    authorization = botTestToken,
  ) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${authorization}`,
        'Content-Type': 'application/json',
        ...(mutationId ? { 'x-dovo-mutation-id': mutationId } : {}),
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    })
  const draft = (): Task => ({
    id: randomUUID(),
    repositoryId: SCRATCH_PROJECT_ID,
    title: 'Release helper',
    agentId: '',
    harness: defaultTaskHarness('codex'),
    execution: 'main',
    status: 'draft',
    createdAt: new Date().toISOString(),
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
  const create = async (task = draft(), requestId = randomUUID(), mutationId?: string) => {
    const response = await request(
      '/api/bots/create',
      { requestId, createTask: task, role: 'Release manager', responsibilities: 'Watch releases.' },
      'POST',
      mutationId,
    )
    return { response, task, requestId }
  }
  return {
    get runtime() {
      return runtime
    },
    prompts,
    inputs,
    async restart() {
      await runtime.close()
      runtime = await start()
    },
    request,
    draft,
    create,
  }
}
