import { allToolRounds } from './all-tool-instruction-cases.mjs'
import { instructionCases } from './model-instruction-cases.mjs'
const clone = (test) => structuredClone(test)
const existing = (id) => clone(instructionCases.find((test) => test.id === id))
const select = (round) => allToolRounds[round].map(clone)

const knowledge = select(16)
knowledge.find((test) => test.id === 'bot-history-recall').mentions = ['Tuesday']
knowledge.find((test) => test.id === 'bot-history-recall').steps[0].patterns = {
  query: 'release|day',
}
knowledge.find((test) => test.id === 'project-memory-stays-local').responses.memory_write.revision =
  '00000000-0000-4000-8000-000000000001'
const reviews = select(17)
reviews.find((test) => test.id === 'pending-question-is-not-an-answer').responses.ask_question = {
  id: 'question-42',
  status: 'pending',
  delivery: 'conversation',
  note: 'The answer will steer the active turn or arrive as a follow-up. Continue independent work, or finish your turn if you need the answer. A pending question is not an answer or approval.',
}
const children = select(18)
children[0].prompt = children[0].prompt.replace(
  'Read its result after the start reply says it finished.',
  'Read its result when the start reply shows it is no longer running.',
)
children[0].responses.subagent_read.result =
  'Reviewed src/api/routes.ts and src/api/schema.ts. POST /notes is the only API endpoint. It decodes NotesInput before storage and returns HTTP 400 on invalid input. No input validation defects found in this static review. A live server was not tested.'
children[0].mentions = ['routes\\.ts', 'schema\\.ts']
const discover = {
  id: 'paired-tools-by-computer',
  prompt:
    'List paired computer Studio and its enabled tools. No computer IDs are known. Inspect that computer through discovery. Do not probe the tools or change settings.',
  steps: [
    { tool: 'studio_discover', absent: ['runtimeId'] },
    { tool: 'studio_discover', fields: { runtimeId: 'runtime-42' } },
  ],
  responses: {
    studio_discover: {
      byRuntime: {
        local: {
          enabled: {
            threads: true,
            automations: true,
            browsers: true,
            ui: true,
            diagnostics: true,
          },
          computers: [
            { id: 'local', name: 'This computer', local: true },
            { id: 'runtime-42', name: 'Studio', local: false },
          ],
        },
        'runtime-42': {
          enabled: {
            threads: true,
            automations: false,
            browsers: false,
            ui: false,
            diagnostics: true,
          },
          projects: [],
          agents: [],
        },
      },
    },
  },
  mentions: ['Studio', 'thread', 'diagnostic'],
}
const remote = clone(allToolRounds[19].find((test) => test.id === 'run-authorized-workflow'))
const reference = clone(allToolRounds[19].find((test) => test.id === 'remote-thread-reference'))
const terminal = clone(allToolRounds[21][0])
terminal.prompt =
  'Our tool-session terminal terminal-42 is already open. Rename it Build logs, send q with a carriage return, read its output, then close it. Do not open a second terminal.'
terminal.id = 'known-terminal-lifecycle'
terminal.steps = [
  { tool: 'terminal_rename', fields: { id: 'terminal-42', title: 'Build logs' } },
  ...terminal.steps.slice(2),
]
terminal.responses.terminal_rename = { id: 'terminal-42', title: 'Build logs' }
const native = {
  id: 'unsupported-native-control',
  prompt:
    'Device discovery and capability inspection already finished for physical iPhone physical-ios:phone-42. Its returned controls do not include pinch. It has no multi-touch runner. Can you pinch to zoom on it? If unavailable, explain it without trying another transport or changing setup.',
  steps: [],
  responses: {},
  mentions: ['unavailable|not (?:available|support)|cannot|can.t|no .*runner'],
}
const privacy = {
  id: 'no-cross-bot-history',
  prompt:
    "Can you retrieve a different Bot's private messages through this Bot's history tool? Explain its scope. Do not query private notes or other tools.",
  steps: [],
  responses: {},
  mentions: ['this Bot|current Bot|own (?:Bot|history)|same Bot'],
}
export const allToolFollowups = {
  22: knowledge,
  23: reviews,
  24: [...children, discover],
  25: [
    remote,
    reference,
    terminal,
    existing('artifact-reuse-preserve-content'),
    existing('stopped-pr-watch'),
    existing('unknown-watch-check-state'),
    native,
    privacy,
    clone(knowledge.find((test) => test.id === 'bot-history-recall')),
    clone(reviews.find((test) => test.id === 'pending-question-is-not-an-answer')),
  ],
}
