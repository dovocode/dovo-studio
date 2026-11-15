import { allToolRounds } from './all-tool-instruction-cases.mjs'
import { allToolFollowups } from './all-tool-instruction-followups.mjs'
import { instructionCases } from './model-instruction-cases.mjs'

const copy = (value) => structuredClone(value)
const existing = (id) => copy(instructionCases.find((test) => test.id === id))
const final = copy(allToolFollowups[25])
const remote = copy(allToolRounds[19])
const discovery = copy(allToolFollowups[24].at(-1))
remote[remote.findIndex((test) => test.id === 'discover-computers')] = discovery
const interfaces = copy(allToolRounds[21])
const artifact = interfaces.find((test) => test.id === 'create-requested-artifact')
artifact.prompt =
  'Save a persistent Markdown artifact titled Release note. Its exact content is "Build verified." with no trailing newline. Reuse an existing artifact if one exists. Do not write repository files.'
for (const cases of [remote, final]) {
  const run = cases.find((test) => test.id === 'run-authorized-workflow')
  if (run) run.prompt += ' Start only and report the run ID. Do not wait for completion.'
}

export const finalToolRounds = {
  26: copy(allToolFollowups[22]),
  27: copy(allToolFollowups[23]),
  28: copy(allToolFollowups[24]),
  29: remote,
  30: copy(allToolRounds[20]),
  31: interfaces,
  32: copy(final),
  33: [
    'pending-private-input-is-not-completed',
    'private-input-cancelled-independent-work',
    'failed-watch-is-not-active',
    'unknown-watch-check-state',
    'new-link-needs-follow-up',
    'plan-does-not-authorize-workers',
    'pr-without-monitoring-request',
    'stale-checklist-is-not-authorization',
  ].map(existing),
  34: [
    copy(allToolFollowups[24].find((test) => test.id === 'phase-attach-known-child')),
    copy(allToolFollowups[23].find((test) => test.id === 'review-command-button')),
    copy(allToolRounds[19].find((test) => test.id === 'runtime-health')),
    copy(allToolRounds[19].find((test) => test.id === 'local-ui-theme')),
    copy(allToolRounds[20].find((test) => test.id === 'forward-dev-port')),
    copy(allToolFollowups[22].find((test) => test.id === 'bot-history-recall')),
    copy(allToolFollowups[23].find((test) => test.id === 'pending-question-is-not-an-answer')),
    existing('artifact-reuse-preserve-content'),
  ],
  35: copy(final),
}

// Fail preparation instead of silently omitting an intended regression case.
for (const [round, cases] of Object.entries(finalToolRounds)) {
  if (cases.some((test) => !test)) throw new Error('Missing final-round case in ' + round)
  if (new Set(cases.map((test) => test.id)).size !== cases.length)
    throw new Error('Duplicate final-round case in ' + round)
}
