// Frozen round-36 task checks. Historical strict scores remain unchanged.
import { finalToolRounds } from './final-tool-instruction-cases.mjs'
import { scoreInstructions } from './model-instruction-cases.mjs'

const saved = new Map()
for (const cases of Object.values(finalToolRounds))
  for (const test of cases) saved.set(test.id, structuredClone(test))
export const qualityCoreIds = [
  'authorized-child-result',
  'bot-history-recall',
  'pending-question-is-not-an-answer',
  'pending-private-input-is-not-completed',
  'stopped-pr-watch',
  'artifact-reuse-preserve-content',
  'native-discovery-install',
  'local-ui-theme',
  'isolated-browser-current-ref',
  'bot-skill-proposal',
  'installed-help-search-read',
  'known-terminal-lifecycle',
]
const core = qualityCoreIds.map((id) => saved.get(id))
const coverage = new Set(core.flatMap((test) => test.steps.map((step) => step.tool)))
const remaining = [...saved.values()].filter((test) => !qualityCoreIds.includes(test.id))
const transfer = []
while (remaining.some((test) => test.steps.some((step) => !coverage.has(step.tool)))) {
  remaining.sort(
    (a, b) =>
      new Set(b.steps.map((s) => s.tool).filter((t) => !coverage.has(t))).size -
      new Set(a.steps.map((s) => s.tool).filter((t) => !coverage.has(t))).size,
  )
  const test = remaining.shift()
  transfer.push(test)
  test.steps.forEach((step) => coverage.add(step.tool))
}
export const qualityCases = [...core, ...transfer]
const byId = (id) => qualityCases.find((test) => test.id === id)
const read = (tool, fields = {}, action) => ({ tool, fields, ...(action ? { action } : {}) })
for (const id of [
  'native-discovery-install',
  'native-type-submit',
  'native-long-press',
  'native-tap',
  'native-swipe',
  'native-home-button',
]) {
  const test = byId(id)
  const deviceId = test.steps.find((s) => s.fields?.id)?.fields.id
  test.verificationSteps = [read('device', { id: deviceId }, 'screenshot')]
  test.responses.device ??= { actions: {} }
  test.responses.device.actions.screenshot = {
    visible: true,
    description: 'Requested device action is visible.',
  }
  if (id !== 'native-discovery-install') {
    test.verificationSteps.push(read('device', { id: deviceId }, 'capabilities'), read('devices'))
    test.responses.device.actions.capabilities = {
      ok: true,
      controls: ['tap', 'swipe', 'text', 'key', 'home', 'long-press', 'screenshot'],
    }
    test.responses.devices = { devices: [{ id: deviceId, state: 'booted' }] }
  }
}
const theme = byId('local-ui-theme')
theme.verificationSteps = [read('studio_ui', { sessionId: 'session-42' }, 'theme-read')]
theme.responses.studio_ui.actions['theme-read'] = {
  sessionId: 'session-42',
  mode: 'dark',
  palette: 'default',
}
byId('artifact-reuse-preserve-content').verificationSteps = [
  read('artifact_read', { id: '00000000-0000-4000-8000-000000000042' }),
]
const artifact = byId('create-requested-artifact')
artifact.verificationSteps = [read('artifact_read', { id: 'artifact-42' })]
artifact.responses.artifact_read = {
  artifact: {
    id: 'artifact-42',
    revision: 1,
    title: 'Release note',
    format: 'markdown',
    content: 'Build verified.',
  },
}
byId('bot-history-recall').verificationSteps = [read('bot_history')]
byId('installed-help-search-read').verificationSteps = [read('dovo_help', {}, 'search')]
for (const id of ['known-terminal-lifecycle', 'persistent-terminal-lifecycle'])
  byId(id).verificationSteps = [read('terminal_read', { id: 'terminal-42' })]
const forward = byId('forward-dev-port')
forward.verificationSteps = [read('devices')]
forward.responses.devices = {
  hosts: [{ id: 'host-42', name: 'Mac', authorized: true }],
  devices: [],
}
const browser = byId('isolated-browser-current-ref')
browser.taskSteps = browser.steps.filter(
  (step, index) => !(step.action === 'snapshot' && index === 1),
)
browser.verificationSteps = [read('browser', {}, 'snapshot')]

/** Task success allows at most two explicitly listed verification reads. Exact
 * writes, required order, access boundaries, invalid calls and errors still fail.
 * The historical strict result is stored beside this result, never replaced. */
export function scoreToolQuality(
  test,
  calls,
  error,
  text = '',
  nativeAttempts = [],
  toolAttempts = [],
  directory = '',
) {
  const strict = scoreInstructions(test, calls, error, text, nativeAttempts, toolAttempts)
  const match = (step, call) => scoreInstructions({ id: test.id, steps: [step] }, [call]).correct
  const required = test.taskSteps ?? test.steps
  let progress = 0,
    extraReads = 0,
    unexpected = 0
  const pending = [...required]
  for (const original of calls) {
    let call = original
    if (test.id === 'remote-thread-reference' && call.tool === 'studio_threads') {
      const input = call.input?.command ?? call.input
      const runtime = call.input?.runtimeId
      if (runtime && runtime !== 'runtime-42') {
        unexpected++
        continue
      }
      if (input?.id === 'thread-7' && runtime === 'runtime-42')
        call = {
          ...call,
          input: { ...call.input, command: { ...input, id: 'studio:runtime-42:thread:thread-7' } },
        }
    }
    if (
      test.id === 'native-discovery-install' &&
      call.tool === 'device_install' &&
      directory &&
      call.input?.artifactPath === directory + '/output/Release-iphoneos/Dovo.app'
    )
      call = { ...call, input: { ...call.input, artifactPath: 'output/Release-iphoneos/Dovo.app' } }
    if (call.fixtureError || call.valid !== true) {
      unexpected++
      continue
    }
    const next = test.unordered
      ? pending.findIndex((step) => match(step, call))
      : progress < required.length && match(required[progress], call)
        ? 0
        : -1
    if (next >= 0) {
      if (test.unordered) pending.splice(next, 1)
      progress++
      continue
    }
    if (
      [...(test.verificationSteps ?? []), ...(test.optionalSteps ?? [])].some((step) =>
        match(step, call),
      ) &&
      extraReads < 2
    ) {
      extraReads++
      continue
    }
    unexpected++
  }
  const taskComplete =
    !error &&
    progress === required.length &&
    unexpected === 0 &&
    strict.textMatch &&
    nativeAttempts.length === 0 &&
    strict.rejectedArguments === 0
  return {
    ...strict,
    taskComplete,
    extraReads,
    unexpectedCalls: unexpected,
    requiredCompleted: progress,
    requiredTasks: required.length,
  }
}
