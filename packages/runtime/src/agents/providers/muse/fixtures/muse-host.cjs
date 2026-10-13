const { createInterface } = require('node:readline')
const { writeFileSync } = require('node:fs')
const messages = []
let cursor = 0,
  turn = ''
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n')
const reply = (id, result) => send({ id, result })
const event = (method, params = {}) =>
  send({
    method,
    params: {
      sessionId: 's',
      viewCursor: String(++cursor),
      sourceRange: {
        first: { line: cursor },
        last: { line: cursor },
        stream: { id: 's', kind: 'session' },
      },
      ...params,
    },
  })
const item = (id, text, status = 'inProgress', revision = 1, kind = 'agentMessage') => ({
  itemId: id,
  kind,
  turnId: turn,
  status,
  revision,
  text,
})
function finish() {
  event('item/started', { item: item('p', '') })
  event('item/delta', { itemId: 'p', delta: 'Working.' })
  event('item/completed', { item: item('p', 'Working.', 'completed', 2) })
  event('item/started', { item: item('f', '') })
  event('item/delta', { itemId: 'f', delta: 'Done.' })
  event('item/completed', { item: item('f', 'Done.', 'completed', 2) })
  event('turn/completed', { turnId: turn, terminal: 'completed' })
}
createInterface({ input: process.stdin }).on('line', (line) => {
  const v = JSON.parse(line),
    p = v.params || {}
  messages.push(v)
  writeFileSync(process.env.TEST_RECORD, JSON.stringify(messages))
  if (v.method === 'initialize' && !/^[a-z0-9_]+$/.test(p.clientInfo?.name || ''))
    return send({
      id: v.id,
      error: {
        code: -32602,
        message:
          'invalid initialize params: clientInfo.name must be a machine identifier matching ^[a-z0-9_]+$ (SS1.4.1)',
        data: { kind: 'invalidParams' },
      },
    })
  if (v.method === 'initialize')
    return reply(v.id, {
      schema: { version: 1, fingerprint: 'test' },
      grantedCapabilities: process.env.NO_MCP ? [] : ['sessionMcp'],
      experimentalApi: false,
      sessionDurability: 'durable',
      serverInfo: { name: 'fixture', version: '1' },
      museHome: '/tmp/muse',
      platformFamily: 'unix',
      platformOs: 'macos',
      userAgent: 'test',
    })
  if (v.method === 'initialized') return
  if (v.method === 'model/list')
    return reply(v.id, {
      models: [
        {
          modelId: 'a',
          providerId: 'meta',
          displayLabel: 'A',
          variants: ['low', 'high'],
          defaultReasoningEffort: 'low',
          isDefault: true,
          isActive: false,
        },
      ],
      providerId: 'meta',
      profileId: null,
      source: 'fakeCatalog',
    })
  if (v.method === 'session/start' || v.method === 'session/resume')
    return reply(v.id, { session: { sessionId: 's' }, viewCursor: '0' })
  if (v.method === 'turn/start') {
    turn = p.commandId
    reply(v.id, {
      commandId: turn,
      status: 'accepted',
      disposition: 'started',
      startedNewTurn: true,
      turnId: turn,
    })
    event('turn/started', { turnId: turn, commandId: turn })
    if (p.input[0].text === 'native') {
      event('item/started', {
        item: {
          itemId: 'child-item',
          kind: 'subagent',
          subagentId: 'child',
          agentPath: 'child',
          controlStatus: 'running',
          status: 'inProgress',
          revision: 1,
          turnId: turn,
        },
      })
      event('turn/completed', { turnId: turn, terminal: 'completed' })
      setTimeout(
        () =>
          event('approval/requested', {
            approvalId: 'approve',
            itemId: 'tool',
            taskId: 'task',
            toolCallId: 'tool',
            judgeEscalated: false,
            protectedWrite: false,
            rawArgs: 'pwd',
            currentRequirementId: 'requirement',
            subagentOrigin: {
              subagentId: 'child',
              childSessionId: 'child-session',
              agentPath: 'child',
            },
            subject: { kind: 'shell', command: 'pwd' },
            availableChoices: [
              { choiceId: 'once', decision: 'approved', scope: 'once', label: 'Allow' },
              { choiceId: 'deny', decision: 'denied', scope: 'once', label: 'Deny' },
            ],
          }),
        30,
      )
      return
    }
    if (p.input[0].text === 'hold') return
    if (p.input[0].text === 'disconnect') return setTimeout(() => process.exit(0), 10)
    if (p.input[0].text === 'approval') {
      event('approval/requested', {
        approvalId: 'approve',
        itemId: 'tool',
        taskId: 'task',
        toolCallId: 'tool',
        judgeEscalated: false,
        protectedWrite: false,
        rawArgs: 'pwd',
        currentRequirementId: 'requirement',
        subject: { kind: 'shell', command: 'pwd' },
        availableChoices: [
          { choiceId: 'once', decision: 'approved', scope: 'once', label: 'Allow' },
          {
            choiceId: 'session',
            decision: 'approvedForSession',
            scope: 'session',
            label: 'Allow for session',
          },
          {
            choiceId: 'always',
            decision: 'approvedPolicyAmendment',
            scope: 'localPersistent',
            label: 'Always allow',
          },
          { choiceId: 'deny', decision: 'denied', scope: 'once', label: 'Deny' },
        ],
      })
      return
    }
    if (p.input[0].text === 'retry') {
      event('turn/retryScheduled', {
        turnId: turn,
        nextAttempt: 2,
        maxAttempts: 3,
        reason: 'Overloaded',
        retryDelayMs: 100,
      })
      finish()
      return
    }
    if (p.input[0].text === 'usage') {
      event('session/contextUsage', { usedTokens: 12000, windowTokens: 200000 })
      event('session/tokenUsage', {
        turnId: turn,
        promptTokens: 100,
        usage: { inputTokens: 90, outputTokens: 10, cachedTokens: 40, reasoningTokens: 3 },
      })
      event('session/todoListChanged', {
        items: [
          { text: 'Step one', status: 'completed' },
          { text: 'Step two', status: 'inProgress' },
        ],
      })
      finish()
      return
    }
    if (p.input[0].text === 'question') {
      event('userInput/requested', {
        userInputId: 'question',
        itemId: 'tool',
        toolCallId: 'tool',
        toolName: 'ask_user',
        turnId: turn,
        questions: [
          {
            id: 'answer',
            header: 'Question',
            question: 'Continue?',
            options: [{ label: 'yes' }, { label: 'no' }],
            selection: { mode: 'single' },
          },
        ],
      })
      return
    }
    if (p.input[0].text === 'fail') {
      event('turn/completed', {
        turnId: turn,
        terminal: 'failed',
        error: { kind: 'providerError', message: 'Model failed', retryable: false },
      })
      return
    }
    finish()
    return
  }
  if (v.method === 'subagent/stop') {
    reply(v.id, { commandId: p.commandId, status: 'accepted' })
    event('item/completed', {
      item: {
        itemId: 'child-item',
        kind: 'subagent',
        subagentId: 'child',
        controlStatus: 'closed',
        status: 'completed',
        revision: 2,
        turnId: turn,
      },
    })
    return
  }
  if (v.method === 'turn/steer') {
    reply(v.id, { commandId: p.commandId, status: 'accepted', turnId: turn })
    finish()
    return
  }
  if (v.method === 'approval/decide' || v.method === 'userInput/answer') {
    reply(v.id, { commandId: p.commandId, status: 'accepted' })
    finish()
    return
  }
  if (v.method === 'session/compact') {
    reply(v.id, { commandId: p.commandId, status: 'accepted' })
    event('item/completed', {
      item: {
        itemId: 'compact',
        kind: 'compaction',
        turnId: null,
        status: 'completed',
        revision: 1,
        outcome: 'compacted',
      },
    })
    return
  }
  if (v.id !== undefined) reply(v.id, { commandId: p.commandId, status: 'accepted' })
})
