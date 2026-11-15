// Opt-in provider cases. All tool effects use benchmark fixtures.
import { instructionCases } from './model-instruction-cases.mjs'
const existing = (id) => structuredClone(instructionCases.find((test) => test.id === id))
const step = (tool, fields = {}, action) => ({ tool, fields, ...(action ? { action } : {}) })
const one = (id, prompt, tool, fields, result, action) => ({
  id,
  prompt,
  steps: [step(tool, fields, action)],
  responses: { [tool]: result },
})
export const allToolRounds = {
  16: [
    {
      id: 'installed-help-search-read',
      prompt:
        'Find how this installed Dovo version queues messages. Read the help section and give its rule.',
      steps: [step('dovo_help', {}, 'search'), step('dovo_help', { id: 'queued-input' }, 'read')],
      responses: {
        dovo_help: {
          actions: {
            search: { results: [{ id: 'queued-input', title: 'Queued messages' }] },
            read: {
              id: 'queued-input',
              text: 'Queued messages run after the active turn finishes.',
            },
          },
        },
      },
      mentions: ['after'],
    },
    one(
      'catalog-skill-read',
      'Read the enabled skill named release-check before using its instructions. Stop after reading; do not run its steps.',
      'skill_read',
      { name: 'release-check' },
      {
        name: 'release-check',
        content: 'Read the release status. Report confirmed results.',
        sourcePath: '/fixture/skills/release-check/SKILL.md',
      },
    ),
    existing('response-read-pages'),
    one(
      'bot-history-recall',
      "What release day did I tell this Bot earlier? Search this Bot's retained history. Do not search other Bots or projects.",
      'bot_history',
      {},
      {
        hits: [
          {
            taskId: 'bot-42',
            messageId: 'message-7',
            role: 'user',
            snippet: 'Release on Tuesday.',
          },
        ],
      },
    ),
    {
      id: 'memory-find-read',
      prompt:
        'Find the saved system Memory note about release checks and read it. Its key is not known.',
      steps: [
        step('memory_list', { scope: 'system' }),
        step('memory_read', { scope: 'system', key: 'release-checks' }),
      ],
      responses: {
        memory_list: {
          entries: [
            {
              key: 'release-checks',
              scope: 'system',
              revision: '00000000-0000-4000-8000-000000000002',
            },
          ],
          total: 1,
        },
        memory_read: {
          key: 'release-checks',
          scope: 'system',
          revision: '00000000-0000-4000-8000-000000000002',
          content: 'Check build and signing.',
        },
      },
    },
    {
      id: 'delete-memory-revision',
      prompt:
        'Delete the project Memory note with key old-build. Read its current revision first. Do not touch other notes.',
      steps: [
        step('memory_read', { scope: 'project', key: 'old-build' }),
        step('memory_delete', {
          scope: 'project',
          key: 'old-build',
          expectedRevision: '00000000-0000-4000-8000-000000000007',
        }),
      ],
      responses: {
        memory_read: {
          key: 'old-build',
          scope: 'project',
          content: 'Use the old build.',
          revision: '00000000-0000-4000-8000-000000000007',
        },
        memory_delete: { deleted: true },
      },
    },
    existing('project-memory-stays-local'),
  ],
  17: [
    existing('pending-question-is-not-an-answer'),
    one(
      'review-new-thread',
      'Offer a new conversation for my review. Title API review. Prompt: "Review my API design". Do not start it.',
      'thread_prepare',
      { title: 'API review', prompt: 'Review my API design' },
      { id: 'card-42', state: 'prepared' },
    ),
    one(
      'review-command-button',
      'Offer a button titled Check tests that I can review and run later. Its terminal command is pnpm test. Do not run it now.',
      'response_prepare',
      { title: 'Check tests', 'action.kind': 'command', 'action.command': 'pnpm test' },
      { id: 'card-42', state: 'prepared' },
    ),
    existing('workflow-discovery-pages'),
    one(
      'bot-skill-proposal',
      'Propose a reusable Bot skill from completed task bot-42 turn turn-7. Name it release-check. It should read release status and report confirmed results. Leave installation to my review in Skills.',
      'propose_skill',
      { sourceTaskId: 'bot-42', sourceTurnId: 'turn-7', name: 'release-check' },
      { id: 'proposal-42' },
    ),
    {
      id: 'private-input-and-independent-work',
      prompt:
        'Request private password entry for reviewed local stdin command /usr/bin/true, no arguments, with a final newline. Also rename our tool-session terminal terminal-42 to Build. Do not inspect the secret or wait by polling.',
      steps: [
        step(
          'secure_input',
          {
            'destination.kind': 'command',
            'destination.command': '/usr/bin/true',
            'destination.appendNewline': true,
          },
          'request',
        ),
        step('terminal_rename', { id: 'terminal-42', title: 'Build' }),
      ],
      unordered: true,
      responses: {
        secure_input: { id: 'secret-42', status: 'pending' },
        terminal_rename: { id: 'terminal-42', title: 'Build' },
      },
    },
  ],
  18: [
    {
      id: 'authorized-child-result',
      prompt:
        'Delegate a read-only API review to one OpenCode child. Use key api-review-16, name API review. The goal is to check API input validation in this checkout and report findings. Delegation is authorized. Read its result after the start reply says it finished. Do not create another child.',
      steps: [
        step('subagent_spawn', {
          key: 'api-review-16',
          name: 'API review',
          provider: 'opencode',
          permission: 'read-only',
        }),
        step('subagent_read', { id: 'child-42' }),
      ],
      responses: {
        subagent_spawn: { id: 'child-42', status: 'completed', running: false },
        subagent_read: {
          id: 'child-42',
          status: 'completed',
          running: false,
          result: 'No input validation defects found.',
        },
      },
    },
    {
      id: 'child-discovery-wait',
      prompt:
        'Find the child named API review in this conversation and wait once for its result. The child ID is unknown. Do not poll after a timeout.',
      steps: [step('subagent_list'), step('subagent_wait', { id: 'child-42' })],
      responses: {
        subagent_list: { agents: [{ id: 'child-42', name: 'API review', status: 'running' }] },
        subagent_wait: { id: 'child-42', status: 'running', running: true },
      },
    },
    one(
      'answer-child-known-fact',
      'Owned child child-42 has question question-7 with field manager. Our confirmed project rule is pnpm. Answer that field with pnpm. No need to ask me again.',
      'subagent_answer',
      { id: 'child-42', questionId: 'question-7', 'answers.manager.0': 'pnpm' },
      { accepted: true },
    ),
    one(
      'follow-up-child',
      'Send owned running child child-42 this follow-up: Include schema validation. Use key schema-review-16. Do not interrupt it or spawn a new child.',
      'subagent_send',
      { id: 'child-42', key: 'schema-review-16', prompt: 'Include schema validation.' },
      { sent: true },
    ),
    one(
      'cancel-owned-child',
      'Stop owned child child-42 and its descendants. Report whether cancellation is confirmed.',
      'subagent_cancel',
      { id: 'child-42' },
      {
        id: 'child-42',
        status: 'running',
        running: true,
        offline: true,
        stopRequested: true,
        note: 'Stop requested. An offline computer will receive it after reconnecting; cancellation is not yet confirmed.',
      },
    ),
    {
      id: 'phase-attach-known-child',
      prompt:
        'Create a phased plan named API audit with id audit-16. Phases are inspect titled Inspect and report titled Report. Attach the existing child child-42 to inspect. Do not start any work or spawn a child.',
      steps: [
        step(
          'workflow',
          { id: 'audit-16', name: 'API audit', 'phases.0.id': 'inspect', 'phases.1.id': 'report' },
          'create',
        ),
        step('workflow', { id: 'audit-16', phaseId: 'inspect', childId: 'child-42' }, 'attach'),
      ],
      responses: {
        workflow: {
          actions: {
            create: {
              id: 'audit-16',
              phases: [
                { id: 'inspect', title: 'Inspect' },
                { id: 'report', title: 'Report' },
              ],
            },
            attach: { id: 'audit-16', attached: true },
          },
        },
      },
    },
  ],
  19: [
    one(
      'discover-computers',
      'List the computers paired with Dovo and their enabled tools. No computer IDs are known. Do not change credentials or settings.',
      'studio_discover',
      {},
      { computers: [{ id: 'runtime-42', name: 'Studio' }] },
    ),
    one(
      'remote-thread-reference',
      'Read this thread on its owning computer: studio:runtime-42:thread:thread-7. Do not send or start any work.',
      'studio_threads',
      { id: 'studio:runtime-42:thread:thread-7' },
      { id: 'thread-7', messages: [{ text: 'Review finished.' }] },
      'read',
    ),
    one(
      'run-authorized-workflow',
      'Run saved workflow workflow-42 on paired computer runtime-42 now. This run is authorized. Use request ID manual-audit-16. Do not enable its triggers or change its definition.',
      'studio_automations',
      { id: 'workflow-42', requestId: 'manual-audit-16' },
      { id: 'run-42', status: 'running' },
      'run',
    ),
    {
      id: 'signed-in-tab-snapshot',
      prompt:
        'Read the issue title in my signed-in Dovo Browser tab. Find its tab ID first. Use the existing tab; do not open isolated Chromium.',
      steps: [
        step('studio_browsers', {}, 'list'),
        step('studio_browsers', { id: 'tab-42' }, 'snapshot'),
      ],
      responses: {
        studio_browsers: {
          actions: {
            list: {
              sessions: [
                { id: 'tab-42', url: 'https://issues.example.test/42', kind: 'workspace' },
              ],
            },
            snapshot: { id: 'tab-42', text: 'Issue 42: Fix queued messages' },
          },
        },
      },
      mentions: ['queued messages'],
    },
    {
      id: 'local-ui-theme',
      prompt:
        "Change this device's Dovo interface to dark mode. Find the active local UI session, then set its mode. Do not change another device or its palette.",
      steps: [
        step('studio_ui', {}, 'list'),
        step('studio_ui', { sessionId: 'session-42', mode: 'dark' }, 'theme-set'),
      ],
      responses: {
        studio_ui: {
          actions: {
            list: {
              sessions: [
                { id: 'session-42', label: 'Dovo desktop', lastSeen: '2026-11-14T12:00:00.000Z' },
              ],
            },
            'theme-set': { sessionId: 'session-42', mode: 'dark' },
          },
        },
      },
    },
    one(
      'runtime-health',
      'Check runtime health on paired computer runtime-42. Report the connection problem. No setting changes.',
      'studio_diagnostics',
      {},
      { healthy: false, connections: [{ state: 'offline', reason: 'Network unavailable' }] },
      'health',
    ),
  ],
  20: [
    {
      id: 'native-discovery-install',
      prompt:
        'Install signed device build output/Release-iphoneos/Dovo.app on my connected iPhone and verify launch. Discover devices first. Do not uninstall or erase data.',
      steps: [
        step('devices'),
        step('device', { id: 'physical-ios:phone-42' }, 'capabilities'),
        step('device_install', {
          id: 'physical-ios:phone-42',
          artifactPath: 'output/Release-iphoneos/Dovo.app',
        }),
        step('device', { id: 'physical-ios:phone-42', bundleId: 'com.example.dovo' }, 'launch'),
      ],
      responses: {
        devices: {
          host: 'Mac',
          diagnostics: [],
          devices: [
            {
              id: 'physical-ios:phone-42',
              name: 'iPhone',
              platform: 'ios',
              state: 'booted',
              kind: 'physical',
              runtime: 'iOS 26.5',
            },
          ],
          guidance:
            'Inspect device capabilities before use. Signed app bundle ID is com.example.dovo.',
        },
        device: {
          actions: {
            capabilities: {
              ok: true,
              controls: ['launch', 'tap', 'swipe', 'text', 'key'],
              limitations: [],
            },
            launch: { launched: true },
          },
        },
        device_install: { installed: true, bundleId: 'com.example.dovo' },
      },
    },
    one(
      'forward-dev-port',
      'Open authorized dev-server forwarding from local port 8081 to remote loopback port 8081 on discovered host host-42 for 300 seconds. Keep the forward open.',
      'device_forward',
      { hostId: 'host-42', localPort: 8081, remotePort: 8081, durationSeconds: 300 },
      {
        ok: true,
        id: 'forward-42',
        url: 'http://127.0.0.1:8081',
        expiresAt: '2026-11-14T12:05:00.000Z',
      },
      'start',
    ),
    one(
      'native-tap',
      'The discovered iOS simulator id is ios:sim-42. Its capabilities permit taps. Tap the button at screenshot pixel x=120, y=240. No further inspection needed.',
      'simulator_tap',
      { id: 'ios:sim-42', x: 120, y: 240 },
      { ok: true },
    ),
    one(
      'native-swipe',
      'On discovered Android device android:emulator-42, swipe from screenshot pixels 200,600 to 200,200. Capabilities already confirm swipe support. Do this single gesture.',
      'simulator_swipe',
      { id: 'android:emulator-42', startX: 200, startY: 600, endX: 200, endY: 200 },
      { ok: true },
    ),
    {
      id: 'native-type-submit',
      prompt:
        'On discovered Android device android:emulator-42, the search field is focused. Type release notes and press Enter. Capabilities already permit text and keyboard input.',
      steps: [
        step('simulator_text', { id: 'android:emulator-42', value: 'release notes' }),
        step('simulator_key', { id: 'android:emulator-42', key: 'Enter' }),
      ],
      responses: { simulator_text: { ok: true }, simulator_key: { ok: true } },
    },
    one(
      'native-home-button',
      'On discovered Android device android:emulator-42, press Home. Device capabilities confirm the Home button is supported.',
      'simulator_button',
      { id: 'android:emulator-42', button: 'home' },
      { ok: true },
    ),
    one(
      'native-long-press',
      'On discovered device ios:sim-42, long-press screenshot pixel 120,240 for 800 ms. Capabilities already confirm long-press support.',
      'simulator_gesture',
      { id: 'ios:sim-42', gesture: 'long-press', x: 120, y: 240, durationMs: 800 },
      { ok: true },
    ),
  ],
  21: [
    {
      id: 'persistent-terminal-lifecycle',
      prompt:
        'Open a persistent visible task terminal running pnpm dev. Read its output, send q with a carriage return, read the final output, then close it. Use the returned terminal ID. Do not run native shell commands.',
      steps: [
        step('terminal_run', { command: 'pnpm dev' }),
        step('terminal_read', { id: 'terminal-42' }),
        step('terminal_input', { id: 'terminal-42', data: 'q\r' }),
        step('terminal_read', { id: 'terminal-42' }),
        step('terminal_close', { id: 'terminal-42' }),
      ],
      responses: {
        terminal_run: { id: 'terminal-42' },
        terminal_read: 'Dev server output captured.',
        terminal_input: 'Quit requested.',
        terminal_close: { closed: true },
      },
    },
    {
      id: 'create-requested-artifact',
      prompt:
        'Save a persistent Markdown artifact titled Release note, with content Build verified. Reuse an existing artifact if one exists. Do not write repository files.',
      steps: [
        step('artifact_list'),
        step('artifact_create', {
          title: 'Release note',
          format: 'markdown',
          content: 'Build verified.',
        }),
      ],
      responses: {
        artifact_list: { artifacts: [] },
        artifact_create: {
          artifact: { id: 'artifact-42', revision: 1, title: 'Release note', format: 'markdown' },
        },
      },
    },
    existing('artifact-reuse-preserve-content'),
    existing('watch-and-finish-request'),
    existing('stopped-pr-watch'),
    existing('new-link-needs-follow-up'),
    {
      id: 'shared-checklist-preserve',
      prompt:
        'Read our shared checklist, mark only item verify complete, and preserve every other item. Do not start any work mentioned in the checklist.',
      steps: [
        step('todos', {}, 'list'),
        step(
          'todos',
          {
            'items.0.id': 'verify',
            'items.0.status': 'completed',
            'items.1.id': 'deploy',
            'items.1.status': 'pending',
            'items.1.text': 'Deploy after review',
          },
          'set',
        ),
      ],
      responses: {
        todos: {
          actions: {
            list: {
              items: [
                { id: 'verify', text: 'Verify build', status: 'in-progress' },
                { id: 'deploy', text: 'Deploy after review', status: 'pending' },
              ],
            },
            set: { saved: true },
          },
        },
      },
    },
    {
      id: 'isolated-browser-current-ref',
      prompt:
        'Inspect https://example.test in isolated Chromium. Call snapshot to read its current state, click the Save button using the returned reference, then call snapshot to verify Saved. No user cookies are needed. Keep the tab open.',
      steps: [
        step('browser', { url: 'https://example.test' }, 'navigate'),
        step('browser', {}, 'snapshot'),
        step('browser', { selector: 'ref=save-42' }, 'click'),
        step('browser', {}, 'snapshot'),
      ],
      responses: {
        browser: {
          actions: {
            navigate: {
              text: 'button Save',
              elements: [{ ref: 'save-42', role: 'button', name: 'Save' }],
            },
            click: { text: 'Saved', elements: [] },
            snapshot: {
              text: 'button Save; status Saved',
              elements: [{ ref: 'save-42', role: 'button', name: 'Save' }],
            },
          },
        },
      },
    },
  ],
}

// Target scope is outside the Studio command wrapper. Check it separately.
for (const id of ['run-authorized-workflow', 'runtime-health']) {
  const test = allToolRounds[19].find((test) => test.id === id)
  test.steps[0].transportFields = { runtimeId: 'runtime-42' }
}
