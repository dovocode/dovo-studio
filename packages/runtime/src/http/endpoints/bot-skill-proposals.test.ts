import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { botResultSchema, decode } from '@dovo/protocol'
import { setupBotRuntime } from '../../testing/bots'
import { waitForRuntime } from '../../testing/integration'
import { Schema } from 'effect'
import { mutableStruct, mutableArray } from '@dovo/protocol'
import { proposeBotSkill } from '../../agent-tools/bot-skills'

it('proposes through real MCP without installing, then applies a reviewed Bot-only diff once', async () => {
  const f = await setupBotRuntime(),
    s = f.runtime.services
  const { id } = decode(botResultSchema, await (await f.create()).response.json())
  await f.request('/api/tasks/message', {
    id,
    messageId: randomUUID(),
    text: 'Complete reusable work',
  })
  await waitForRuntime(() => expect(s.store.taskSummary(id).status).toBe('review'))
  const source = s.store.task(id).turns!.at(-1)!
  let proposalId = ''
  f.runtime.run.mockImplementation(async (run) => {
    const config = run.agent.resources?.mcpServers.find((server) => server.name === 'dovo_task')
    if (!config) throw new Error('Missing task tools')
    const client = new Client({ name: 'skill-proposal-test', version: '1' })
    try {
      await client.connect(
        new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: config.envValues,
          stderr: 'ignore',
        }),
      )
      expect((await client.listTools()).tools.some((t) => t.name === 'propose_skill')).toBe(true)
      const answer = await client.callTool({
        name: 'propose_skill',
        arguments: {
          key: 'review-release',
          sourceTaskId: id,
          sourceTurnId: source.id,
          name: 'release-review',
          description: 'Review a release',
          content: 'Check release status and report verified results.',
        },
      })
      expect(answer.isError).not.toBe(true)
      const result = decode(
        mutableStruct({
          content: mutableArray(mutableStruct({ type: Schema.String, text: Schema.String })),
        }),
        answer,
      )
      proposalId = decode(
        mutableStruct({ id: Schema.String }),
        JSON.parse(result.content[0].text),
      ).id
      const credential = decode(
        mutableStruct({ token: Schema.String }),
        JSON.parse(readFileSync(config.envValues?.DOVO_TASK_CREDENTIAL_FILE ?? '', 'utf8')),
      )
      expect(
        (
          await f.request(
            '/api/bots/skill-proposal/decide',
            {
              id,
              proposalId,
              expectedRevision: s.store.taskSummary(id).bot!.revision,
              accept: true,
            },
            'POST',
            undefined,
            credential.token,
          )
        ).status,
      ).toBe(403)
    } finally {
      await client.close()
    }
    run.onText('Review the proposed skill in Skills.')
  })
  await f.request('/api/tasks/message', {
    id,
    messageId: randomUUID(),
    text: 'Propose the method as a skill',
  })
  await waitForRuntime(() => expect(proposalId).not.toBe(''))
  expect(s.store.taskSummary(id).bot?.resources?.skills ?? []).toHaveLength(0)
  const bot = s.store.taskSummary(id).bot!
  expect(bot.skillProposals?.[0].patch).toContain('+Check release status')
  const input = { id, proposalId, expectedRevision: bot.revision, accept: true }
  expect((await f.request('/api/bots/skill-proposal/decide', input)).status).toBe(200)
  expect((await f.request('/api/bots/skill-proposal/decide', input)).status).toBe(200)
  expect(s.store.taskSummary(id).bot?.resources?.skills).toHaveLength(1)
  await f.restart()
  expect(f.runtime.services.store.taskSummary(id).bot?.resources?.skills[0].name).toBe(
    'release-review',
  )
})

it('rejects foreign sources, secrets, stale review and conflicting skill edits', async () => {
  const f = await setupBotRuntime(),
    s = f.runtime.services
  const { id } = decode(botResultSchema, await (await f.create()).response.json())
  await f.request('/api/tasks/message', { id, messageId: randomUUID(), text: 'Finished work' })
  await waitForRuntime(() => expect(s.store.taskSummary(id).status).toBe('review'))
  const input = {
    key: 'skill',
    sourceTaskId: id,
    sourceTurnId: s.store.task(id).turns!.at(-1)!.id,
    name: 'method',
    description: 'A method',
    content: 'A useful method',
  }
  expect(() => proposeBotSkill(s, id, { ...input, sourceTaskId: randomUUID() })).toThrow(
    /not found/i,
  )
  expect(() => proposeBotSkill(s, id, { ...input, content: 'password: secret-value' })).toThrow(
    /secrets/,
  )
  const proposal = proposeBotSkill(s, id, input)
  expect(proposeBotSkill(s, id, input)).toEqual(proposal)
  const revision = s.store.taskSummary(id).bot!.revision
  expect(
    (
      await f.request('/api/bots/skill-proposal/decide', {
        id,
        proposalId: proposal.id,
        expectedRevision: randomUUID(),
        accept: true,
      })
    ).status,
  ).toBe(409)
  expect(
    (
      await f.request('/api/bots/skill-proposal/decide', {
        id,
        proposalId: proposal.id,
        expectedRevision: revision,
        accept: false,
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await f.request('/api/bots/skill-proposal/decide', {
        id,
        proposalId: proposal.id,
        expectedRevision: s.store.taskSummary(id).bot!.revision,
        accept: true,
      })
    ).status,
  ).toBe(409)
  expect(s.store.taskSummary(id).bot?.resources?.skills ?? []).toHaveLength(0)
  const conflict = proposeBotSkill(s, id, { ...input, key: 'conflict' })
  const bot = s.store.taskSummary(id).bot!
  const edited = {
    name: input.name,
    description: 'Human edit',
    content: 'Keep this edit',
    enabled: true,
  }
  expect(
    (
      await f.request('/api/bots/update', {
        id,
        expectedRevision: bot.revision,
        resources: { mcpServers: [], skills: [edited], disabledMcpServers: [], disabledSkills: [] },
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await f.request('/api/bots/skill-proposal/decide', {
        id,
        proposalId: conflict.id,
        expectedRevision: s.store.taskSummary(id).bot!.revision,
        accept: true,
      })
    ).status,
  ).toBe(409)
  expect(s.store.taskSummary(id).bot?.resources?.skills[0]).toEqual(edited)
})
