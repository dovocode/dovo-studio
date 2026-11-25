import {
  decode,
  mutableStruct,
  nodeDataSchema,
  snapshotSchema,
  type Automation,
  type AutomationData,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { expect, it, vi } from 'vite-plus/test'
import { ForgeWork } from '../scm/work/forge-work.js'
import { fixture } from '../testing/fixture.js'
import { setupBotRuntime } from '../testing/bots.js'
import { waitForRuntime } from '../testing/integration.js'

const url = 'https://github.com/owner/project/actions/runs/125/attempts/2'

function workflow(resultStepId?: string): Automation {
  const nodes = (['trigger', 'task', 'pipeline-wait', 'task'] as const).map((kind, index) => {
    const id = String(index)
    const data: AutomationData = {
      kind: kind === 'pipeline-wait' ? 'review' : kind,
      label: index === 3 ? 'Report' : kind,
      trigger: 'manual',
      schedule: '',
      timezone: 'UTC',
      objective: index === 3 ? 'Report the result' : 'Return the run attempt URL',
      agentId: 'agent',
      repositoryId: 'repo',
      ...(index === 1 && resultStepId ? { resultSchema: '{"type":"string"}' } : {}),
      ...(kind === 'pipeline-wait'
        ? {
            pipelineWait: { url: resultStepId ? '' : url, resultStepId, timeoutMinutes: 1 },
          }
        : {}),
    }
    return { id, type: 'automation' as const, position: { x: index, y: 0 }, data }
  })
  return {
    id: 'ci-flow',
    name: 'CI wait',
    nodes,
    enabled: false,
    edges: nodes.slice(1).map((node, index) => ({
      id: node.id,
      source: String(index),
      target: node.id,
    })),
  }
}
async function setup(resultStepId?: string) {
  const f = await setupBotRuntime()
  const project = await fixture()
  f.runtime.services.store.update((workspace) => ({
    ...workspace,
    agents: project.workspace.agents,
    repositories: project.workspace.repositories,
    automations: [workflow(resultStepId)],
  }))
  return { f, project }
}

it('resumes the same CI attempt after restart and admits the next worker once', async () => {
  const { f, project } = await setup('1')
  try {
    const attempt = vi.spyOn(ForgeWork.prototype, 'githubAttempt').mockResolvedValue(undefined)
    f.runtime.run.mockImplementationOnce(async (input) => input.onText(JSON.stringify(url)))
    const response = await f.request('/api/jobs/run', { id: 'ci-flow', requestId: 'start-ci' })
    expect(response.status).toBe(200)
    const { id } = decode(mutableStruct({ id: Schema.String }), await response.json())
    const before = f.runtime.services.jobs
    await waitForRuntime(() => expect(before.summary(id).status).toBe('waiting'))
    const wait = before.summary(id).pipelineWait
    expect(wait).toMatchObject({ url })
    const snapshot = decode(
      snapshotSchema,
      await (await f.request('/api/snapshot?scope=overview', undefined, 'GET')).json(),
    )
    expect(snapshot.automationPipelineWaitSupported).toBe(true)
    const saved = snapshot.workspace.automations.find((item) => item.id === 'ci-flow')!
    const legacyStep = nodeDataSchema.mapFields(
      ({ pipelineWait: _pipelineWait, ...fields }) => fields,
    )
    const oldNodes = saved.nodes.map((node) => ({ ...node, data: decode(legacyStep, node.data) }))
    expect(oldNodes[2].data.kind).toBe('review')
    expect(
      (
        await f.request(
          '/api/workspace',
          {
            collection: 'automations',
            id: saved.id,
            changes: {
              nodes: { before: saved.nodes, after: oldNodes },
            },
          },
          'PATCH',
        )
      ).status,
    ).toBe(409)
    expect(
      f.runtime.services.store.get().automations[0].nodes[2].data.pipelineWait?.resultStepId,
    ).toBe('1')
    expect(
      (await f.request('/api/jobs/review', { id, allow: true, nodeId: '2', attempt: 1 })).status,
    ).toBe(409)
    await waitForRuntime(async () => {
      await before.tickPipelineWaits()
      expect(attempt).toHaveBeenCalledWith('repo', url)
    })
    expect(f.runtime.run).toHaveBeenCalledTimes(1)
    await f.restart()
    const after = f.runtime.services.jobs
    expect(after.summary(id).pipelineWait).toEqual(wait)
    attempt.mockResolvedValue('success')
    await Promise.all([after.tickPipelineWaits(), after.tickPipelineWaits()])
    await waitForRuntime(() => expect(after.summary(id).status).toBe('completed'))
    await after.tickPipelineWaits()
    expect(f.runtime.run).toHaveBeenCalledTimes(1)
    expect(after.summary(id).steps?.find((step) => step.nodeId === '2')).toMatchObject({
      status: 'completed',
      attempt: 1,
    })
    const reviews = f.runtime.services.activity.remoteMcpEvents.poll({
      name: 'automation.needs_review',
    })
    expect(reviews.events).toEqual([])
  } finally {
    await project.cleanup()
  }
})

it.each(['cancel', 'timeout', 'failure'] as const)(
  'does not launch downstream work on CI %s',
  async (outcome) => {
    const { f, project } = await setup()
    try {
      let release!: (value: string) => void
      const attempt = vi.spyOn(ForgeWork.prototype, 'githubAttempt').mockReturnValue(
        new Promise((resolve) => {
          release = resolve
        }),
      )
      const jobs = f.runtime.services.jobs
      const id = jobs.start('ci-flow')
      await waitForRuntime(() => expect(jobs.summary(id).status).toBe('waiting'))
      const poll = jobs.tickPipelineWaits()
      try {
        await waitForRuntime(() => expect(attempt).toHaveBeenCalledWith('repo', url))
        if (outcome === 'cancel') await jobs.cancel(id)
        if (outcome === 'timeout') jobs.tick(Date.parse(jobs.summary(id).pipelineWait!.until))
      } finally {
        release(outcome === 'failure' ? 'failure' : 'success')
        await poll
      }
      expect(jobs.summary(id)).toMatchObject({
        status: outcome === 'cancel' ? 'cancelled' : 'failed',
        pipelineWait: undefined,
        ...(outcome === 'cancel' ? {} : { failedNodeId: '2' }),
      })
      expect(f.runtime.run).toHaveBeenCalledTimes(1)
    } finally {
      await project.cleanup()
    }
  },
)
