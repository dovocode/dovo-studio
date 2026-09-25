#!/usr/bin/env node
// Deterministic app-server fixture. It never executes the displayed tool command.
// The explicit checkpoint test prompt writes one fixture file in the test checkout.
const readline = require('node:readline')
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n')
const notify = (method, params) => send({ jsonrpc: '2.0', method, params })
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  if (!request.method) {
    if (request.id === 'fixture-question') {
      const answers = request.result?.answers
      const accepted =
        answers?.approach?.answers?.[0] === 'Use existing patterns' &&
        answers?.details?.answers?.[0] === 'Keep it compact'
      notify('item/agentMessage/delta', {
        delta: accepted ? 'Question answers verified.' : 'Question declined or unexpected answers.',
      })
      notify('turn/completed', { turn: { status: 'completed' } })
    }
    return
  }
  let result = {}
  if (request.method === 'initialize') result = { userAgent: 'codex/0.155.1' }
  if (request.method === 'account/read') result = { account: { type: 'chatgpt' } }
  if (request.method === 'configRequirements/read') result = { requirements: null }
  if (request.method === 'thread/start' || request.method === 'thread/resume')
    result = {
      thread: { id: 'fixture-session' },
      approvalPolicy: request.params.approvalPolicy,
      approvalsReviewer: request.params.approvalsReviewer,
      sandbox: {
        type:
          request.params.sandbox === 'danger-full-access'
            ? 'dangerFullAccess'
            : request.params.sandbox === 'workspace-write'
              ? 'workspaceWrite'
              : 'readOnly',
      },
    }
  if (request.method === 'model/list')
    result = {
      data: [
        {
          model: 'fixture/model',
          displayName: 'Fixture model',
          description: 'Local test fixture',
          isDefault: true,
          serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Fixture priority tier' }],
          supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }],
          defaultReasoningEffort: 'high',
        },
        {
          model: 'gpt-daybreak-blue-latest',
          displayName: 'Daybreak Blue',
          description: 'Fixture authorized cybersecurity model',
          isDefault: false,
          hidden: false,
          modelSpecialty: 'cyber',
          serviceTiers: [],
          supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }],
          defaultReasoningEffort: 'low',
        },
        ...(process.env.DOVO_FIXTURE_CODEX_LONG_CATALOG === '1'
          ? Array.from({ length: 14 }, (_, index) => ({
              model: `fixture/extra-${index + 1}`,
              displayName: `Extra fixture model ${index + 1}`,
              description: 'Long catalog picker fixture',
              isDefault: false,
              serviceTiers: [],
              supportedReasoningEfforts: [],
            }))
          : []),
      ],
      nextCursor: null,
    }
  send({ jsonrpc: '2.0', id: request.id, result })
  if (request.method === 'turn/start') {
    if (
      JSON.stringify(request.params).includes(
        'Generate a task title for this JSON-encoded task description',
      )
    ) {
      notify('item/agentMessage/delta', { delta: 'Simplify task creation' })
      notify('turn/completed', { turn: { status: 'completed' } })
      return
    }
    if (JSON.stringify(request.params).includes('Checkpoint verification'))
      require('node:fs').writeFileSync(
        require('node:path').join(process.cwd(), 'checkpoint-fixture.txt'),
        'Checkpoint fixture change\n',
      )
    if (JSON.stringify(request.params).includes('Attachment verification')) {
      const input = request.params.input ?? []
      const context = input.find((item) => item.type === 'text')?.text ?? ''
      const images = input.filter((item) => item.type === 'localImage')
      const accepted =
        context.includes('Attachment fixture context') &&
        (!context.includes('with image') ||
          images.some((item) => require('node:fs').readFileSync(item.path).length > 0))
      notify('item/agentMessage/delta', {
        delta: accepted ? 'Attachment inputs verified.' : 'Attachment fixture input was missing.',
      })
      notify('turn/completed', { turn: { status: 'completed' } })
      return
    }
    if (JSON.stringify(request.params).includes('Question verification')) {
      notify('item/agentMessage/delta', { delta: 'Choose the direction before I continue. ' })
      send({
        jsonrpc: '2.0',
        id: 'fixture-question',
        method: 'item/tool/requestUserInput',
        params: {
          threadId: 'fixture-session',
          turnId: 'fixture-turn',
          itemId: 'fixture-question',
          questions: [
            {
              id: 'approach',
              header: 'Approach',
              question: 'How should we build this?',
              isOther: false,
              isSecret: false,
              options: [
                { label: 'Use existing patterns', description: 'Keep components focused.' },
              ],
            },
            {
              id: 'details',
              header: 'Details',
              question: 'Anything to keep in mind?',
              isOther: true,
              isSecret: false,
              options: null,
            },
          ],
        },
      })
      return
    }
    if (JSON.stringify(request.params).includes('Long reply preview')) {
      // A realistic, long Markdown answer for reviewing conversation typography.
      notify('item/agentMessage/delta', {
        delta: [
          'Both apps are now more stable. I checked every change against a separate test runtime.',
          '',
          '## Stability',
          '- **Crashes:** each tab now shows a recovery screen with **Try again**.',
          '- **Offline:** a computer shows as **Offline** only after a request fails.',
          '- **Messages:** a send that fails on a network blip now retries automatically.',
          '',
          'I also updated `verify-devices.cjs` and the pairing docs. Nothing is committed.',
          '',
          '**Not covered:**',
          '',
          '- Android',
          '- the real Electron window',
          '',
          'The simulator now needs Metro running (`pnpm dev:mobile`) to open.',
        ].join('\n'),
      })
      notify('turn/completed', { turn: { status: 'completed' } })
      return
    }
    if (JSON.stringify(request.params).includes('Markdown verification')) {
      notify('item/agentMessage/delta', { delta: '## Rendered reply\n\n**Streaming** Markdown' })
      setTimeout(() => {
        notify('item/agentMessage/delta', { delta: ' is complete.\n\n- Verified output' })
        notify('turn/completed', { turn: { status: 'completed' } })
      }, 5000)
      return
    }
    const command = { id: 'command-1', type: 'commandExecution', command: 'git status --short' }
    notify('item/started', { item: command })
    notify('item/agentMessage/delta', { delta: 'Working on this request. ' })
    // The composer flow ends this turn with Stop, not a race against UI automation speed.
    if (JSON.stringify(request.params).includes('Native first')) return
    setTimeout(() => {
      notify('item/completed', {
        item: {
          ...command,
          status: 'completed',
          exitCode: 0,
          aggregatedOutput: 'Fixture worktree is clean.',
        },
      })
      notify('item/agentMessage/delta', { delta: 'Verified fixture response.' })
      notify('turn/completed', { turn: { status: 'completed' } })
    }, 5000)
  }
})
