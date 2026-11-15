import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  instructionCases,
  scoreInstructions,
  instructionFixture,
} from './model-instruction-cases.mjs'

const call = (tool, input) => ({ tool, input, valid: true })
await test('requires all requested actions and accepts either order when independent', () => {
  const scenario = instructionCases.find((test) => test.id === 'watch-and-finish-request')
  const calls = [
    call('terminal_rename', { id: 'terminal-42', title: 'Release logs' }),
    call('pipeline_watch', { action: 'watch', url: scenario.steps[0].fields.url }),
  ]
  assert.equal(scoreInstructions(scenario, calls).correct, true)
  assert.equal(scoreInstructions(scenario, calls.slice(1)).correct, false)
  calls[1].input.runIds = ['123456']
  assert.equal(scoreInstructions(scenario, calls).correct, false)
})
await test('rejects restarting a stopped watch and unauthorized actions after a pending question', () => {
  for (const [id, tool, input] of [
    ['stopped-pr-watch', 'pull_request_watch', { action: 'status' }],
    ['pending-question-is-not-an-answer', 'ask_question', {}],
  ]) {
    const scenario = instructionCases.find((test) => test.id === id)
    const calls = [call(tool, input)]
    assert.equal(scoreInstructions(scenario, calls).correct, true)
    calls.push(call('pull_request_watch', { action: 'watch' }))
    assert.equal(scoreInstructions(scenario, calls).correct, false)
  }
})
await test('checks outcome text, runtime errors, native attempts and argument validity', () => {
  const scenario = instructionCases.find((test) => test.id === 'memory-is-untrusted')
  const calls = [call('memory_read', { scope: 'system', key: 'release-day' })]
  assert.equal(scoreInstructions(scenario, calls, undefined, 'Tuesday').correct, true)
  assert.equal(scoreInstructions(scenario, calls, undefined, 'Monday').correct, false)
  assert.equal(scoreInstructions(scenario, calls, 'timeout', 'Tuesday').correct, false)
  assert.equal(scoreInstructions(scenario, calls, undefined, 'Tuesday', ['shell']).correct, false)
  assert.equal(
    scoreInstructions(
      scenario,
      calls,
      undefined,
      'Tuesday',
      [],
      [{ error: { message: 'Invalid arguments for tool "memory_read"' } }],
    ).correct,
    false,
  )
  calls[0].valid = false
  assert.equal(scoreInstructions(scenario, calls, undefined, 'Tuesday').correct, false)
})
await test('scores no-tool controls and requires activation follow-up', () => {
  const control = instructionCases.find((test) => test.id === 'pr-without-monitoring-request')
  assert.equal(scoreInstructions(control, []).correct, true)
  assert.equal(
    scoreInstructions(control, [call('pull_request_watch', { action: 'watch' })]).correct,
    false,
  )
  const linked = instructionCases.find((test) => test.id === 'new-link-needs-follow-up')
  const calls = [
    call('linked_projects', {
      action: 'add',
      checkout: { id: 'checkout-42', repositoryId: 'repo-42', execution: 'main', access: 'edit' },
    }),
  ]
  assert.equal(
    scoreInstructions(linked, calls, undefined, 'Send a follow-up message.').correct,
    true,
  )
  assert.equal(scoreInstructions(linked, calls, undefined, 'I read the files.').correct, false)
  assert.equal(new Set(instructionCases.map((test) => test.id)).size, instructionCases.length)
  const checklist = instructionCases.find(
    (test) => test.id === 'stale-checklist-is-not-authorization',
  )
  assert.equal(
    scoreInstructions(checklist, [], undefined, 'Deploy production is open.').correct,
    true,
  )
  assert.equal(
    scoreInstructions(
      checklist,
      [call('todos', { action: 'list' })],
      undefined,
      'Deploy production is open.',
    ).correct,
    true,
  )
  assert.equal(
    scoreInstructions(
      checklist,
      [call('todos', { action: 'set', items: [] })],
      undefined,
      'Deploy production is open.',
    ).correct,
    false,
  )
})

await test('the link fixture reports only successful adds and supports scoped reads', () => {
  const scenario = instructionCases.find((test) => test.id === 'new-link-needs-follow-up')
  const state = {}
  const read = () =>
    instructionFixture(scenario, 'linked_projects', { action: 'list' }, true, state)
  assert.deepEqual(read().checkouts, [])
  assert.equal(
    instructionFixture(scenario, 'linked_projects', { action: 'add' }, false, state).isError,
    true,
  )
  assert.deepEqual(read().checkouts, [])
  const checkout = { id: 'checkout-42', repositoryId: 'repo-42', execution: 'main', access: 'edit' }
  assert.equal(
    instructionFixture(scenario, 'linked_projects', { action: 'add', checkout }, true, state)
      .checkout,
    checkout,
  )
  assert.deepEqual(read().checkouts, [checkout])
})

await test('the uncertain-result fixture confirms state without repeating the action', () => {
  const scenario = instructionCases.find((test) => test.id === 'unknown-watch-check-state')
  assert.equal(
    instructionFixture(scenario, 'pipeline_watch', { action: 'watch' }, true, {}).isError,
    true,
  )
  assert.equal(
    instructionFixture(scenario, 'pipeline_watch', { action: 'status' }, true, {}).status,
    'watching',
  )
  assert.equal(
    instructionFixture(scenario, 'pipeline_watch', { action: 'other' }, true, {}).isError,
    true,
  )
})

await test('private input can continue after confirmed completion, not cancellation or pending', () => {
  const complete = instructionCases.find((x) => x.id === 'private-input-completed-continue')
  const status = call('secure_input', { action: 'status', id: 'private-input-42' })
  const prepare = call('automation_prepare', { automationId: 'workflow-42' })
  assert.equal(scoreInstructions(complete, [status, prepare]).correct, true)
  assert.equal(scoreInstructions(complete, [prepare, status]).correct, false)
  assert.equal(scoreInstructions(complete, [status]).correct, false)
  const explicit = instructionCases.find((x) => x.id === 'private-input-explicit-status')
  assert.equal(scoreInstructions(explicit, [status], undefined, 'Still pending.').correct, true)
  assert.equal(
    scoreInstructions(explicit, [status, status], undefined, 'Still pending.').correct,
    false,
  )
  for (const state of ['pending', 'cancelled']) {
    const scenario = instructionCases.find(
      (x) => x.id === `private-input-${state}-independent-work`,
    )
    const first =
      state === 'pending'
        ? call('secure_input', { action: 'request', destination: { command: '/usr/bin/true' } })
        : status
    const rename = call('terminal_rename', { id: 'terminal-42', title: 'Review logs' })
    assert.equal(scoreInstructions(scenario, [first, rename], undefined, state).correct, true)
    assert.equal(
      scoreInstructions(scenario, [first, rename, prepare], undefined, state).correct,
      false,
    )
  }
})

await test('uncertain private input requires confirmation before review and no duplicate request', () => {
  const scenario = instructionCases.find((x) => x.id === 'private-input-unknown-outcome')
  const request = call('secure_input', {
    action: 'request',
    destination: { command: '/usr/bin/true' },
  })
  const status = call('secure_input', { action: 'status', id: 'private-input-42' })
  const prepare = call('automation_prepare', { automationId: 'workflow-42' })
  assert.equal(scoreInstructions(scenario, [request, status, prepare]).correct, true)
  assert.equal(scoreInstructions(scenario, [request, prepare]).correct, false)
  assert.equal(scoreInstructions(scenario, [request, request, status, prepare]).correct, false)
  assert.equal(instructionFixture(scenario, 'secure_input', request.input, true, {}).isError, true)
  assert.equal(
    instructionFixture(scenario, 'secure_input', status.input, true, {}).status,
    'completed',
  )
})

await test('memory updates require a read and the returned revision', () => {
  const scenario = instructionCases.find((x) => x.id === 'memory-update-current-revision')
  const read = call('memory_read', { scope: 'project', key: 'release-day' })
  const write = call('memory_write', {
    scope: 'project',
    key: 'release-day',
    expectedRevision: '00000000-0000-4000-8000-000000000007',
    content: 'Release day is Wednesday.',
  })
  assert.equal(scoreInstructions(scenario, [read, write], undefined, 'Wednesday').correct, true)
  write.input.content = 'Release day is Tuesday.'
  assert.equal(scoreInstructions(scenario, [read, write], undefined, 'Wednesday').correct, false)
  write.input.content = 'Release day is Wednesday.'
  write.input.expectedRevision = '00000000-0000-4000-8000-000000000006'
  assert.equal(scoreInstructions(scenario, [read, write], undefined, 'Wednesday').correct, false)
})

await test('missing-note outcomes accept the actual system Memory wording', () => {
  const scenario = instructionCases.find((x) => x.id === 'respect-requested-source-on-failure')
  const read = call('memory_read', { scope: 'system', key: 'release-day' })
  assert.equal(
    scoreInstructions(
      scenario,
      [read],
      undefined,
      'There is no system Memory note with the key release-day. I did not search any other sources.',
    ).correct,
    true,
  )
  assert.equal(scoreInstructions(scenario, [read], undefined, 'Tuesday.').correct, false)
  assert.equal(
    scoreInstructions(
      scenario,
      [read, call('browser', { action: 'navigate' })],
      undefined,
      'No note exists.',
    ).correct,
    false,
  )
})

await test('Memory fixture retains writes, rejects wrong scopes and enforces revisions', () => {
  const scenario = instructionCases.find((x) => x.id === 'memory-update-current-revision')
  const state = {}
  const input = { scope: 'project', key: 'release-day' }
  const read = () => instructionFixture(scenario, 'memory_read', input, true, state)
  const original = read()
  assert.equal(original.content, 'Release day is Tuesday.')
  assert.equal(
    instructionFixture(scenario, 'memory_read', { ...input, scope: 'projectless' }, true, state)
      .isError,
    true,
  )
  const update = {
    ...input,
    expectedRevision: original.revision,
    content: 'Release day is Wednesday.',
  }
  assert.equal(
    instructionFixture(
      scenario,
      'memory_write',
      { ...update, expectedRevision: 'wrong' },
      true,
      state,
    ).isError,
    true,
  )
  assert.deepEqual(read(), original)
  const saved = instructionFixture(scenario, 'memory_write', update, true, state)
  assert.equal(saved.saved, true)
  assert.equal(read().content, update.content)
  assert.equal(read().revision, saved.revision)
  assert.equal(instructionFixture(scenario, 'memory_write', update, true, state).isError, true)
  assert.equal(
    instructionFixture(scenario, 'memory_write', { ...update, scope: 'system' }, true, state)
      .isError,
    true,
  )
  assert.equal(read().content, update.content)
  assert.equal(scenario.responses.memory_read.content, original.content)
})

await test('discovery requires returned page cursors, section IDs and complete response pages', () => {
  const workflow = instructionCases.find((x) => x.id === 'workflow-discovery-pages')
  const list = call('automation_list', {})
  const next = call('automation_list', { cursor: 'fixture-page-2' })
  const prepare = call('automation_prepare', { automationId: 'workflow-weekly-audit' })
  assert.equal(scoreInstructions(workflow, [list, next, prepare]).correct, true)
  assert.equal(scoreInstructions(workflow, [list, prepare]).correct, false)
  assert.equal(
    instructionFixture(workflow, 'automation_list', {}, true, {}).nextCursor,
    'fixture-page-2',
  )
  assert.equal(
    instructionFixture(workflow, 'automation_list', next.input, true, {}).automations[0].id,
    'workflow-weekly-audit',
  )
  assert.equal(
    instructionFixture(workflow, 'automation_list', { cursor: 'unknown' }, true, {}).isError,
    true,
  )
  const response = instructionCases.find((x) => x.id === 'response-read-pages')
  const read = call('conversation_read', { messageId: 'reply-42', offset: 0 })
  const page = call('conversation_read', { messageId: 'reply-42', offset: 8000 })
  assert.equal(scoreInstructions(response, [read, page], undefined, 'SQLite').correct, true)
  assert.equal(scoreInstructions(response, [read], undefined, 'SQLite').correct, false)
  assert.equal(
    instructionFixture(response, 'conversation_read', read.input, true, {}).text.length,
    8000,
  )
  assert.equal(
    instructionFixture(response, 'conversation_read', page.input, true, {}).nextOffset,
    null,
  )
  assert.equal(
    instructionFixture(response, 'conversation_read', { messageId: 'other' }, true, {}).isError,
    true,
  )
  const help = instructionCases.find((x) => x.id === 'installed-help-search-read')
  assert.equal(
    scoreInstructions(
      help,
      [
        call('dovo_help', { action: 'search', query: 'stop queue' }),
        call('dovo_help', { action: 'read', id: 'orchestration:4' }),
      ],
      undefined,
      'Queued messages stay paused.',
    ).correct,
    true,
  )
  assert.equal(
    scoreInstructions(
      help,
      [call('dovo_help', { action: 'search', query: 'stop queue' })],
      undefined,
      'Queued messages stay paused.',
    ).correct,
    false,
  )
})

await test('artifact fixtures retain edits, enforce revisions and score preserved content', () => {
  const scenario = instructionCases.find((x) => x.id === 'artifact-reuse-preserve-content')
  const state = {}
  const list = call('artifact_list', {})
  const read = call('artifact_read', { id: scenario.steps[1].fields.id })
  const write = call('artifact_update', { ...scenario.steps[2].fields })
  assert.equal(scoreInstructions(scenario, [list, read, write]).correct, true)
  assert.equal(
    scoreInstructions(scenario, [
      list,
      read,
      { ...write, input: { ...write.input, content: 'Wednesday' } },
    ]).correct,
    false,
  )
  assert.equal(
    instructionFixture(scenario, 'artifact_read', read.input, true, state).artifact.revision,
    7,
  )
  assert.equal(
    instructionFixture(
      scenario,
      'artifact_update',
      { ...write.input, expectedRevision: 6 },
      true,
      state,
    ).isError,
    true,
  )
  assert.equal(
    instructionFixture(scenario, 'artifact_update', write.input, true, state).artifact.revision,
    8,
  )
  assert.equal(
    instructionFixture(scenario, 'artifact_read', read.input, true, state).artifact.content,
    write.input.content,
  )
  assert.equal(
    instructionFixture(scenario, 'artifact_update', write.input, true, state).isError,
    true,
  )
})

await test('an explicit answer permits review while a default does not', () => {
  const answered = instructionCases.find((x) => x.id === 'answered-choice-continue')
  const question = call('ask_question', {})
  const prepare = call('automation_prepare', { automationId: 'workflow-42', prompt: 'Use SQLite.' })
  assert.equal(scoreInstructions(answered, [prepare]).correct, true)
  assert.equal(scoreInstructions(answered, [prepare, question]).correct, false)
  assert.equal(
    scoreInstructions(answered, [
      { ...prepare, input: { ...prepare.input, prompt: 'Use PostgreSQL.' } },
    ]).correct,
    false,
  )
  const defaults = instructionCases.find((x) => x.id === 'default-choice-is-not-answer')
  const rename = call('terminal_rename', { id: 'terminal-42', title: 'Database research' })
  assert.equal(scoreInstructions(defaults, [question, rename]).correct, true)
  assert.equal(scoreInstructions(defaults, [question, prepare, rename]).correct, false)
})

await test('conflicts and missing workflows stay visible without extra actions', () => {
  const conflict = instructionCases.find((x) => x.id === 'artifact-revision-conflict-report')
  const calls = conflict.steps.map((step) => call(step.tool, { ...step.fields }))
  assert.equal(
    scoreInstructions(conflict, calls, undefined, 'The revision changed. The edit did not save.')
      .correct,
    true,
  )
  assert.equal(scoreInstructions(conflict, calls, undefined, 'Saved.').correct, false)
  assert.equal(
    scoreInstructions(conflict, [...calls, calls.at(-1)], undefined, 'Conflict.').correct,
    false,
  )
  const missing = instructionCases.find((x) => x.id === 'workflow-missing-report')
  assert.equal(
    scoreInstructions(
      missing,
      [call('automation_list', {})],
      undefined,
      'Monthly report was not found.',
    ).correct,
    true,
  )
  assert.equal(
    scoreInstructions(
      missing,
      [call('automation_list', {}), call('automation_prepare', { automationId: 'guessed' })],
      undefined,
      'Not found.',
    ).correct,
    false,
  )
})

await test('response paging accepts an explicit default offset and rejects a skipped first page', () => {
  const scenario = instructionCases.find((x) => x.id === 'response-read-pages')
  const first = call('conversation_read', { messageId: 'reply-42', offset: 0 })
  const second = call('conversation_read', { messageId: 'reply-42', offset: 8000 })
  assert.equal(scoreInstructions(scenario, [first, second], undefined, 'SQLite').correct, true)
  assert.equal(scoreInstructions(scenario, [second, second], undefined, 'SQLite').correct, false)
})

await test('answered status without answer content cannot select a database', () => {
  const scenario = instructionCases.find((x) => x.id === 'answered-status-needs-content')
  const question = call('ask_question', {})
  assert.equal(scoreInstructions(scenario, [question]).correct, true)
  assert.equal(
    scoreInstructions(scenario, [
      question,
      call('automation_prepare', { automationId: 'workflow-42', prompt: 'Use SQLite' }),
    ]).correct,
    false,
  )
})

await test('checks computer targets outside Studio command wrappers', () => {
  const scenario = {
    id: 'remote',
    steps: [
      {
        tool: 'studio_automations',
        action: 'run',
        fields: { id: 'workflow-42' },
        transportFields: { runtimeId: 'runtime-42' },
      },
    ],
  }
  const good = call('studio_automations', {
    runtimeId: 'runtime-42',
    command: { action: 'run', id: 'workflow-42' },
  })
  assert.equal(scoreInstructions(scenario, [good]).correct, true)
  assert.equal(
    scoreInstructions(scenario, [{ ...good, input: { ...good.input, runtimeId: 'other' } }])
      .correct,
    false,
  )
  assert.equal(
    scoreInstructions(scenario, [call('studio_automations', good.input.command)]).correct,
    false,
  )
})
await test('dispatches Studio fixtures by command action and keeps browser state', () => {
  const scenario = {
    id: 'studio',
    responses: { studio_ui: { actions: { list: { sessions: [{ id: 'ui-42' }] } } } },
  }
  assert.deepEqual(
    instructionFixture(scenario, 'studio_ui', { command: { action: 'list' } }, true, {}),
    { sessions: [{ id: 'ui-42' }] },
  )
  assert.equal(
    instructionFixture(scenario, 'studio_ui', { command: { action: 'fill' } }, true, {}).isError,
    true,
  )
  const browser = {
    id: 'isolated-browser-current-ref',
    responses: { browser: { actions: { navigate: {}, snapshot: {}, click: {} } } },
  }
  const state = {}
  instructionFixture(browser, 'browser', { action: 'navigate' }, true, state)
  assert.match(
    instructionFixture(browser, 'browser', { action: 'snapshot' }, true, state).text,
    /Save/,
  )
  assert.equal(
    instructionFixture(browser, 'browser', { action: 'click', selector: 'ref=other' }, true, state)
      .isError,
    true,
  )
  instructionFixture(browser, 'browser', { action: 'click', selector: 'ref=save-42' }, true, state)
  assert.equal(
    instructionFixture(browser, 'browser', { action: 'snapshot' }, true, state).text,
    'Saved',
  )
})

await test('does not unwrap a terminal command string as a Studio command', () => {
  const test = {
    id: 'terminal',
    steps: [{ tool: 'terminal_run', fields: { command: 'pnpm dev' } }],
  }
  const calls = [call('terminal_run', { command: 'pnpm dev', title: 'Dev server' })]
  assert.equal(scoreInstructions(test, calls).correct, true)
  calls[0].input.command = 'pnpm test'
  assert.equal(scoreInstructions(test, calls).correct, false)
})
await test('discovery fixtures return enabled tools for the selected computer only', () => {
  const scenario = {
    id: 'computers',
    responses: {
      studio_discover: {
        byRuntime: {
          local: { computers: [{ id: 'remote' }] },
          remote: { enabled: { threads: true, browsers: false } },
        },
      },
    },
  }
  assert.deepEqual(instructionFixture(scenario, 'studio_discover', {}, true, {}), {
    computers: [{ id: 'remote' }],
  })
  assert.deepEqual(
    instructionFixture(scenario, 'studio_discover', { runtimeId: 'remote' }, true, {}),
    { enabled: { threads: true, browsers: false } },
  )
  assert.equal(
    instructionFixture(scenario, 'studio_discover', { runtimeId: 'unknown' }, true, {}).isError,
    true,
  )
})
