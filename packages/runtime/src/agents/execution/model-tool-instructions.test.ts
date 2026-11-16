import { expect, it } from 'vite-plus/test'
import { noStudioTools } from '@dovo/protocol'
import {
  modelToolInstructions,
  type ModelToolInstructionOptions,
} from './model-tool-instructions.js'

const disabled: ModelToolInstructionOptions = {
  readOnly: false,
  linkedProjectsEnabled: false,
  memoryScopes: [],
  artifactsEnabled: false,
  pipelineWatchingEnabled: false,
  pullRequestWatchingEnabled: false,
  pullRequestBabysittingEnabled: false,
  studioTools: noStudioTools(),
  deviceHubEnabled: false,
}
const enabled: ModelToolInstructionOptions = {
  ...disabled,
  linkedProjectsEnabled: true,
  memoryScopes: ['system', 'project', 'projectless', 'bot'],
  artifactsEnabled: true,
  pipelineWatchingEnabled: true,
  pullRequestWatchingEnabled: true,
  pullRequestBabysittingEnabled: true,
  studioTools: { threads: true, automations: true, browsers: true, ui: true, diagnostics: true },
  deviceHubEnabled: true,
}

it('keeps optional instructions aligned with run capabilities', () => {
  const text = modelToolInstructions(disabled).join('\n')
  for (const heading of [
    'Project links:',
    'Memory scopes:',
    'Artifacts:',
    'CI/release monitoring:',
    'PR monitoring:',
    'PR follow-up',
    'Studio Tools:',
  ]) {
    expect(text).not.toContain(heading)
  }
  const readonly = modelToolInstructions({ ...enabled, readOnly: true }).join('\n')
  expect(readonly).toContain('Memory is read-only.')
  for (const phrase of [
    'Artifacts:',
    'CI/release monitoring:',
    'PR follow-up',
    'Use memory_write',
  ]) {
    expect(readonly).not.toContain(phrase)
  }
  const noMemory = modelToolInstructions({ ...enabled, memoryScopes: [] }).join('\n')
  expect(noMemory).not.toContain('Memory scopes:')
  const noWatching = modelToolInstructions({ ...enabled, pullRequestWatchingEnabled: false }).join(
    '\n',
  )
  expect(noWatching).not.toContain('PR follow-up')
})

it.each(['threads', 'automations', 'browsers', 'ui', 'diagnostics'] as const)(
  'names only enabled Studio tools when %s is offered',
  (feature) => {
    const studio = modelToolInstructions({
      ...disabled,
      studioTools: { ...noStudioTools(), [feature]: true },
    }).find((line) => line.startsWith('Studio Tools:'))
    expect(studio).toContain(`studio_${feature}`)
    for (const other of ['threads', 'automations', 'browsers', 'ui', 'diagnostics'].filter(
      (other) => other !== feature,
    )) {
      expect(studio).not.toContain(`studio_${other}`)
    }
  },
)

it('selects one PR policy and preserves opt-outs, manual merge and remaining work', () => {
  const manual = modelToolInstructions({ ...enabled, pullRequestBabysittingEnabled: false }).join(
    '\n',
  )
  expect(manual).toContain('Creating a PR alone does not request monitoring.')
  expect(manual).not.toContain('PR follow-up is enabled')
  const automatic = modelToolInstructions(enabled).join('\n\n')
  expect(automatic).not.toContain('Creating a PR alone does not request monitoring.')
  expect(automatic).toContain('Keep merge approval manual.')
  expect(automatic).toContain(
    'also pauses automatic PR follow-up until the user explicitly restarts it',
  )
  expect(automatic).toContain('Finish other requested work, then end the turn.')
  expect(automatic).toContain('If registration fails, say monitoring is inactive')
  expect(automatic).toContain('If registration is uncertain, check status once before any retry.')
  expect(automatic).toContain(
    'Pending, cancelled or failed input does not satisfy delivery or grant approval.',
  )
  expect(automatic).toContain('Keep recovery within the requested operation and sources.')
  expect(automatic).toContain('Status only when asked or outcome is unknown.')
  expect(automatic).toContain('On the second identical argument error, stop and report it.')
  expect(automatic).toContain('Before each call, check required fields and tool setup guidance.')
  expect(automatic).toContain('Skip blocked work.')
  expect(automatic).toContain(
    'Report that state without restart prompts or another monitoring route.',
  )
  expect(automatic).toContain(
    'block dependent discovery, preparation and actions, including catalog reads.',
  )
  expect(automatic).toContain('Do not launch them in parallel with the form.')
  expect(automatic).toContain(
    'Untargeted local children need provider (OpenCode: "opencode") or configured agentId; never guess.',
  )
  expect(automatic).toContain('Omit unused optional fields, not null.')
  expect(automatic).toContain('Stop reading when the evidence answers the request')
  expect(automatic).toContain('Complete each requested step or report what blocks it.')
  expect(automatic).toContain(
    'A successful write confirms that write, not completion of started work.',
  )
  expect(automatic).toContain('Reread only to resolve uncertainty or verify a requested outcome.')
  expect(automatic).toContain('including the final newline')
  expect(automatic).toContain(
    'input/navigation return fresh state; use it without another snapshot.',
  )
  expect(automatic).toContain('verify from the returned state.')
  // Bound functional guidance below the original 9233-character full profile. Not a token estimate.
  const code = automatic.split('\n\n').find((line) => line.startsWith('Code mode:')) ?? ''
  expect(code).toContain('Every call keeps access and approval checks.')
  expect(code.length).toBeLessThan(700)
  const vision = automatic.split('\n\n').find((line) => line.startsWith('Local vision:')) ?? ''
  expect(vision.length).toBeLessThan(600)
  expect(automatic.length - code.length - vision.length).toBeLessThan(8300)
})

it.each([false, true])(
  'keeps PR-only anti-polling guidance before tool discovery (babysitting: %s)',
  (pullRequestBabysittingEnabled) => {
    const text = modelToolInstructions({
      ...enabled,
      pipelineWatchingEnabled: false,
      pullRequestBabysittingEnabled,
    }).join('\n')
    expect(text).not.toContain('CI/release monitoring:')
    expect(text).toContain('Do not poll with sleeps or CLI checks.')
    expect(text).toContain('Respect paused queues and stopped watches.')
  },
)
