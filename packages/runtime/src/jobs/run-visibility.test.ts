import { expect, it } from 'vite-plus/test'
import { jobRunSchema, snapshotSchema, decode, type Automation } from '@dovo/protocol'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { startRuntime } from '../index.js'

it('keeps an older review in the snapshot and reads an exact retained run by automation and run ID', async () => {
  const ownerToken = 'automation-visibility-owner-token-at-least-32-characters'
  const directory = await mkdtemp(join(tmpdir(), 'dovo-job-visibility-'))
  const options = { databasePath: join(directory, 'jobs.sqlite'), ownerToken, port: 0 }
  let runtime: Awaited<ReturnType<typeof startRuntime>> | undefined
  try {
    const review: Automation = {
      id: 'review-flow',
      name: 'Release review',
      enabled: false,
      nodes: ['trigger', 'review'].map((kind, index) => ({
        id: kind,
        type: 'automation',
        position: { x: index * 100, y: 0 },
        data: {
          kind: index === 0 ? 'trigger' : 'review',
          label: kind,
          trigger: 'manual',
          schedule: '',
          timezone: 'UTC',
          objective: '',
          agentId: '',
          repositoryId: '',
        },
      })),
      edges: [{ id: 'gate', source: 'trigger', target: 'review' }],
    }
    const background = {
      ...review,
      id: 'background-flow',
      nodes: review.nodes.slice(0, 1),
      edges: [],
    }
    const waiting = 'waiting-review'
    const historical = 'finished-0'
    runtime = await startRuntime(options)
    runtime.services.store.update((workspace) => ({
      ...workspace,
      automations: [review, background],
    }))
    await runtime.close()
    runtime = undefined
    const database = new Database(options.databasePath)
    try {
      const insert = database.prepare('INSERT INTO job_runs VALUES (?, ?)')
      const now = Date.now()
      const waitingAt = new Date(now - 200_000).toISOString()
      insert.run(
        waiting,
        JSON.stringify({
          id: waiting,
          automationId: review.id,
          flow: review,
          status: 'waiting',
          completedNodes: ['trigger'],
          taskIds: [],
          waitingNodeId: 'review',
          createdAt: waitingAt,
          updatedAt: waitingAt,
          attempt: 1,
          steps: [
            { nodeId: 'review', label: 'review', kind: 'review', status: 'waiting', attempt: 1 },
          ],
        }),
      )
      for (let index = 0; index <= 100; index++) {
        const id = `finished-${index}`
        const at = new Date(now - 100_000 + index * 100).toISOString()
        insert.run(
          id,
          JSON.stringify({
            id,
            automationId: background.id,
            flow: background,
            triggerPayload: { private: 'fixture' },
            status: 'completed',
            completedNodes: ['trigger'],
            taskIds: [],
            createdAt: at,
            updatedAt: at,
            finishedAt: at,
          }),
        )
      }
    } finally {
      database.close()
    }
    runtime = await startRuntime(options)
    expect(runtime.services.jobs.detail(waiting).status).toBe('waiting')
    const headers = { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' }
    const base = `http://127.0.0.1:${runtime.port}`
    const response = await fetch(`${base}/api/snapshot?scope=overview`, { headers })
    expect(response.ok).toBe(true)
    const snapshot = decode(snapshotSchema, await response.json())
    expect(snapshot.runs.find((run) => run.id === waiting)?.status).toBe('waiting')
    expect(snapshot.runs.some((run) => run.id === historical)).toBe(false)

    const readRun = (automationId: string) =>
      fetch(`${base}/api/jobs/detail`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: historical, automationId }),
      })
    const detail = await readRun(background.id)
    expect(detail.status).toBe(200)
    const saved: unknown = await detail.json()
    expect(decode(jobRunSchema, saved)).toMatchObject({ id: historical, status: 'completed' })
    expect(saved).not.toHaveProperty('flow')
    expect(saved).not.toHaveProperty('triggerPayload')
    expect((await readRun(review.id)).status).toBe(404)

    const event = { name: 'automation.run_finished', arguments: { runIds: [waiting] } } as const
    const feed = runtime.services.activity.remoteMcpEvents
    const cursor = feed.poll({ name: event.name }).cursor
    const approve = await fetch(`${base}/api/jobs/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: waiting, allow: true, nodeId: 'review', attempt: 1 }),
    })
    expect(approve.status).toBe(200)
    await expect.poll(() => runtime?.services.jobs.detail(waiting).status).toBe('completed')
    expect(
      feed.poll({ name: event.name, arguments: { runIds: [waiting] }, cursor }).events,
    ).toMatchObject([{ data: { runId: waiting, outcome: 'completed' } }])
  } finally {
    await runtime?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
