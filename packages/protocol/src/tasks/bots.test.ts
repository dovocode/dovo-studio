import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  applyBotResources,
  botContextMessages,
  botInstructions,
  botLifecyclePresentation,
  inheritedResourceProject,
} from './bots.js'
import { compareBotActivity } from './bot-activity.js'
import {
  botSchema,
  decode,
  defaultTaskHarness,
  mcpServerSchema,
  taskResources,
  taskSchema,
} from '../index.js'

const bot = decode(botSchema, {
  role: 'Release manager',
  responsibilities: 'Watch releases.',
  state: 'active',
  revision: randomUUID(),
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
})

it('matches Lean’s Bot resource precedence and project scope for every generated case', () => {
  const fixture = new URL('../../../../verification/bot-invocation-cases.jsonl', import.meta.url)
  const cases = readFileSync(fixture, 'utf8').trim().split('\n')
  expect(cases).toHaveLength(72)
  for (const line of cases) {
    const { input, inheritsProject, resource, invocation, missingCoordinator, foreignCoordinator } =
      JSON.parse(line) as {
        input: {
          scope: 'thread' | 'mentionCopy' | 'coordinator' | 'invocation'
          own: boolean | null
          inherited: boolean | null
          disabled: boolean
        }
        inheritsProject: boolean
        resource: boolean | null
        invocation: boolean | null
        missingCoordinator: boolean | null
        foreignCoordinator: boolean | null
      }
    const { scope, own, inherited, disabled } = input
    const repositoryId = 'project'
    const task = {
      repositoryId,
      bot: scope === 'coordinator' ? bot : undefined,
      botMention:
        scope === 'invocation' || scope === 'mentionCopy'
          ? { sourceRuntimeId: scope === 'invocation' ? 'caller-runtime' : undefined }
          : undefined,
    }
    expect(inheritedResourceProject(task)).toBe(inheritsProject ? repositoryId : undefined)
    const settings = (enabled: boolean | null) => ({
      skills:
        enabled === null
          ? []
          : [{ name: 'probe', enabled, description: 'Probe', content: 'Probe' }],
      mcpServers:
        enabled === null
          ? []
          : [
              decode(mcpServerSchema, {
                name: 'probe',
                enabled,
                transport: 'stdio',
                command: 'probe',
                args: [],
              }),
            ],
    })
    const disabledNames = disabled ? ['probe'] : []
    const resources = {
      ...settings(own),
      disabledMcpServers: disabledNames,
      disabledSkills: disabledNames,
    }
    const applied = applyBotResources(settings(inherited), { resources })
    expect(applied.skills[0]?.enabled ?? null).toBe(resource)
    expect(applied.mcpServers[0]?.enabled ?? null).toBe(resource)
    if (scope !== 'invocation') continue
    const caller = {
      id: 'invocation',
      agentId: '',
      repositoryId,
      harness: { ...defaultTaskHarness('codex'), resources: settings(true) },
      botMention: {
        runtimeId: 'host',
        botId: 'bot',
        sourceTaskId: 'caller',
        sourceMessageId: 'send',
        sourceRuntimeId: 'caller-runtime',
      },
    }
    const target = {
      id: 'bot',
      agentId: '',
      repositoryId,
      bot: { ...bot, resources },
      harness: { ...defaultTaskHarness('codex'), resources: settings(inherited) },
    }
    for (const [runtimeId, tasks, expected] of [
      ['host', [target], invocation],
      ['host', [], missingCoordinator],
      ['different-host', [target], foreignCoordinator],
    ] as const) {
      const effective = taskResources(caller, { runtimeId, agents: [], repositories: [], tasks })
      expect(effective.skills[0]?.enabled ?? null).toBe(expected)
      expect(effective.mcpServers[0]?.enabled ?? null).toBe(expected)
    }
  }
})

it('separates the Bot hold from an active turn and a separately paused queue', () => {
  const running = { status: 'running', queuePaused: true } as const
  expect(botLifecyclePresentation('paused', running)).toEqual({
    policy: 'New work paused',
    activity: 'Current turn still running',
    queue: 'The queue is paused separately.',
    consequence: 'Resume Bot does not resume the queue.',
  })
  expect(botLifecyclePresentation('active', running).queue).toBe('The queue is paused separately.')
})

it('distinguishes ready work after a restart from a paused message', () => {
  const message = { id: 'queued', role: 'user', text: 'Run checks', createdAt: '' } as const
  expect(
    botLifecyclePresentation('paused', {
      status: 'done',
      queue: [message],
      queuePaused: true,
      restartRecovery: { kind: 'queue', automatic: false },
    }).consequence,
  ).toBe('Ready work can start when the Bot is idle.')
  expect(
    botLifecyclePresentation('paused', { status: 'done', queue: [{ ...message, paused: true }] })
      .consequence,
  ).toBe('Resume Bot does not unpause that message.')
})

it('excludes only reset ranges and retains messages after each reset', () => {
  const messages = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }))
  const reset = (afterMessageId: string, throughMessageId: string) => ({
    requestRevision: randomUUID(),
    turnId: 'turn',
    afterMessageId,
    throughMessageId,
    at: '',
  })
  expect(botContextMessages(messages, { contextResets: [reset('b', 'd')] })).toEqual([
    messages[0],
    messages[1],
    messages[4],
    messages[5],
  ])
  expect(
    botContextMessages(messages, { contextResets: [reset('b', 'd'), reset('a', 'e')] }),
  ).toEqual([messages[0], messages[5]])
  expect(botContextMessages(messages, { contextResets: [reset('missing', 'd')] })).toEqual(messages)
  expect(messages).toHaveLength(6)
})

it('orders pinned Bots first and uses conversation activity rather than settings or read state', () => {
  const task = (id: string, date: string) =>
    decode(taskSchema, {
      id,
      title: id,
      repositoryId: '',
      agentId: '',
      status: 'review',
      createdAt: date,
      draft: '',
      messages: [],
      files: [],
      example: false,
      bot,
    })
  const older = task('older', '2026-11-01T00:00:00Z')
  const newer = task('newer', '2026-11-02T00:00:00Z')
  expect([older, newer].sort(compareBotActivity).map((t) => t.id)).toEqual(['newer', 'older'])
  older.pinned = true
  expect([newer, older].sort(compareBotActivity).map((t) => t.id)).toEqual(['older', 'newer'])
})

it('steers supported Bots toward background delegation while respecting user limits', () => {
  expect(botInstructions(bot, true)).toContain('subagent_spawn')
  expect(botInstructions(bot, true)).toContain(
    'unless the user or repository instructions restrict delegation',
  )
  expect(botInstructions(bot, true)).toContain('finish your reply')
  expect(botInstructions(bot, true)).toContain('Expected output, and Verification')
  expect(botInstructions(bot, true)).toContain('advance only after checking')
  expect(botInstructions(bot, true)).toContain('data.botId')
  expect(botInstructions(bot, true)).toContain('neither you nor a worker can approve it')
  expect(botInstructions(bot)).not.toContain('subagent_spawn')
  expect(botInstructions(bot)).toContain('delegation tools are unavailable')
})
