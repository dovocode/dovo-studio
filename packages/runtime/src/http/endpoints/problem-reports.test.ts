import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import {
  MAX_PROBLEM_REPORT_BYTES,
  PROBLEM_REPORT_ATTACHMENT_NAME,
  SCRATCH_PROJECT_ID,
  decode,
  defaultTaskHarness,
  problemReportPreviewSchema,
  problemReportStart,
  snapshotSchema,
  threadStartResultSchema,
  type ProblemReportRequest,
  type Task,
} from '@dovo/protocol'
import { startRuntime } from '../../index'
import type { AgentAdapter } from '../../agents/execution/types'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const token = 'problem-report-owner-token-at-least-32-characters'
// Realistic secret shapes that reach runtime logs.
const deviceToken = 'Q9vJ3kTq_x7LmZp2RfA8sW-cY1nBdE4hUoK6gVtXy0M'
const runToken = 'dovo_run_Zk3Lp8Qw-Rt5Ym2Nb7Vc1Xs4Hd9Gf6Ja0Ke_UoIi'
const apiKey = 'sk-ant-api03-Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv-WxYz_123456'
const environmentSecret = 'hunter2-correct-horse-battery'
const privateKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dovo-problem-report-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  vi.stubEnv('MY_SERVICE_PASSWORD', environmentSecret)
  const runtime = await startRuntime({
    databasePath: join(root, 'runtime.sqlite'),
    ownerToken: token,
    port: 0,
  })
  cleanups.push(runtime.close)
  const run = vi.fn<AgentAdapter['run']>(async (input) => {
    input.onSession('provider-session')
    input.onText('Triage started')
  })
  vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run,
  })
  const request = (path: string, input?: unknown, method = 'POST') =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: input === undefined ? undefined : JSON.stringify(input),
    })
  return { root, runtime, request, run }
}
const report = (include = { versions: true, diagnostics: true, clientErrors: true }) =>
  ({
    description: `Sending a message fails after pairing. My key ${apiKey} is set.`,
    expected: 'The message is sent.',
    include,
    client: { surface: 'desktop', appVersion: '0.0.7', channel: 'nightly', platform: 'darwin' },
    clientErrors: [
      {
        at: '2026-11-16T10:00:00.000Z',
        source: 'view',
        message: `TypeError: failed at /Users/dominic/Library/App with Bearer ${deviceToken}`,
      },
    ],
  }) satisfies ProblemReportRequest
const draft = (): Task => ({
  id: randomUUID(),
  repositoryId: SCRATCH_PROJECT_ID,
  title: 'Problem: Sending a message fails',
  agentId: '',
  harness: defaultTaskHarness('codex'),
  execution: 'main',
  status: 'draft',
  createdAt: new Date().toISOString(),
  messages: [],
  files: [],
  draft: '',
  example: false,
})

it('previews redacted client stacks and bounded category-only actions only when included', async () => {
  const f = await setup()
  const input: ProblemReportRequest = {
    ...report(),
    include: { versions: false, diagnostics: false, clientErrors: true, clientTimeline: true },
    clientErrors: [
      {
        at: '2026-11-17T12:00:00Z',
        message: 'Network failure',
        name: 'TypeError',
        stack: `TypeError: token=${environmentSecret}\n at request (/home/dominic/app.ts:12)`,
      },
    ],
    clientTimeline: [
      {
        at: '2026-11-17T12:00:00Z',
        action: 'request-failed',
        category: 'threads',
        status: 503,
        durationMs: 50,
      },
      {
        at: '2026-11-17T12:00:01Z',
        action: 'connecting',
        category: 'connection',
        routeFailover: { purpose: 'stream', reason: 'saved-address-stream-failed' },
      },
    ],
  }
  const response = await f.request('/api/problem-reports/preview', input)
  expect(response.status).toBe(200)
  const included = decode(problemReportPreviewSchema, await response.json()).attachment?.text ?? ''
  expect(included).toContain('## Recent client actions')
  expect(included).toContain('request-failed')
  expect(included).toContain('saved-address-stream-failed')
  expect(included).toContain('app.ts:12')
  expect(included).not.toContain(environmentSecret)
  expect(included).not.toContain('/home/dominic/')
  const excludedResponse = await f.request('/api/problem-reports/preview', {
    ...input,
    include: { ...input.include, clientErrors: false, clientTimeline: false },
  })
  expect(
    decode(problemReportPreviewSchema, await excludedResponse.json()).attachment,
  ).toBeUndefined()
  const invalid = await f.request('/api/problem-reports/preview', {
    ...input,
    clientTimeline: [{ ...input.clientTimeline?.[0], action: 'private text' }],
  })
  expect(invalid.status).toBe(400)
})

it('advertises problem reports and previews a bounded, redacted bundle with the source commit', async () => {
  const f = await setup()
  const snapshot = decode(
    snapshotSchema,
    await (await f.request('/api/snapshot', undefined, 'GET')).json(),
  )
  expect(snapshot.problemReportsSupported).toBe(true)
  // A long log with secrets in old and new lines. Only the newest lines fit.
  const old = Array.from({ length: 40_000 }, (_, index) => `old line ${index} padding`).join('\n')
  await writeFile(
    join(f.root, 'server.log'),
    [
      old,
      `request Authorization: Bearer ${deviceToken}`,
      `agent token ${runToken}`,
      `connecting with ${environmentSecret}`,
      'Cookie: session=abc123; theme=dark',
      'opened /home/dominic/.dovo/runtime.sqlite',
      'loaded deploy key:',
      privateKey.trimEnd(),
      'NEWEST LOG LINE',
    ].join('\n'),
  )
  const response = await f.request('/api/problem-reports/preview', report())
  expect(response.status).toBe(200)
  const preview = decode(problemReportPreviewSchema, await response.json())
  const text = preview.attachment?.text ?? ''
  expect(preview.attachment?.name).toBe(PROBLEM_REPORT_ATTACHMENT_NAME)
  expect(preview.attachment?.bytes).toBe(Buffer.byteLength(text))
  expect(preview.attachment?.bytes).toBeLessThanOrEqual(MAX_PROBLEM_REPORT_BYTES)
  // A source checkout reports its Git commit; packaged builds record it at build time.
  expect(text).toMatch(/Source commit: [0-9a-f]{40}/)
  expect(text).toMatch(/Runtime version: \S+/)
  expect(text).toContain('Reporting client: desktop, version 0.0.7, nightly channel, on darwin')
  expect(text).toContain('## Runtime health')
  expect(text).toContain('NEWEST LOG LINE')
  expect(text).not.toContain('old line 0 ')
  expect(text).toContain('## Recent client errors')
  expect(text).toContain('/Users/[user]/Library/App')
  for (const secret of [deviceToken, runToken, apiKey, environmentSecret, 'abc123', 'dominic'])
    expect(text + preview.message).not.toContain(secret)
  // Logs are redacted as a whole, so no line of a multi-line private key survives.
  for (const line of privateKey.split('\n').filter((item) => item && !item.startsWith('-----')))
    expect(text).not.toContain(line)
  expect(text).toContain('-----BEGIN RSA PRIVATE KEY----- [redacted] -----END RSA PRIVATE KEY-----')
  expect(preview.redactions).toBeGreaterThanOrEqual(6)
  expect(preview.message).toContain('Sending a message fails after pairing.')
  expect(preview.message).toMatch(
    /commit [0-9a-f]{40} from https:\/\/github\.com\/dovocode\/dovo-studio/,
  )
  expect(preview.message).toContain('Do not create the issue')

  const none = decode(
    problemReportPreviewSchema,
    await (
      await f.request(
        '/api/problem-reports/preview',
        report({ versions: false, diagnostics: false, clientErrors: false }),
      )
    ).json(),
  )
  expect(none.attachment).toBeUndefined()
  expect(none.message).toContain('This report has no source commit')
  expect(none.message).toContain('Diagnostics: I chose not to include any.')

  const empty = await f.request('/api/problem-reports/preview', { ...report(), description: '  ' })
  expect(empty.status).toBe(400)
})

it('starts a projectless thread with the playbook and the reviewed diagnostics attached, once', async () => {
  const f = await setup()
  const input = report()
  const preview = decode(
    problemReportPreviewSchema,
    await (await f.request('/api/problem-reports/preview', input)).json(),
  )
  // Clients send a title made from the unredacted description.
  const task = { ...draft(), title: `Problem: My key ${apiKey}` }
  const messageId = randomUUID()
  const start = problemReportStart(input, preview, task, messageId)
  const first = await f.request('/api/problem-reports/start', start)
  expect(first.status).toBe(200)
  expect(decode(threadStartResultSchema, await first.json()).ok).toBe(true)
  // A retry after a lost response reuses the thread, message and attachment.
  const retry = await f.request('/api/problem-reports/start', start)
  expect(retry.status).toBe(200)
  await waitForRuntime(() => expect(f.run).toHaveBeenCalledOnce())
  const stored = f.runtime.services.store.task(task.id)
  expect(stored.repositoryId).toBe(SCRATCH_PROJECT_ID)
  // The runtime makes the synced title from the redacted description.
  expect(stored.title).toBe(
    'Problem: Sending a message fails after pairing. My key [redacted] is set.',
  )
  const messages = stored.messages.filter((message) => message.role === 'user')
  expect(messages).toHaveLength(1)
  expect(messages[0].text).toBe(preview.message)
  expect(messages[0].attachments?.map((file) => file.name)).toEqual([
    PROBLEM_REPORT_ATTACHMENT_NAME,
  ])
  const attachment = f.runtime.services.attachments.read(
    task.id,
    messages[0].attachments?.[0]?.id ?? '',
  )
  expect(Buffer.from(attachment.data, 'base64').toString('utf8')).toBe(preview.attachment?.text)

  // Text changed after the preview is redacted again before it is stored.
  const edited = draft()
  const changed = await f.request('/api/problem-reports/start', {
    ...problemReportStart(input, preview, edited, randomUUID()),
    attachmentText: `${preview.attachment?.text}\nAuthorization: Bearer ${deviceToken}`,
  })
  expect(changed.status).toBe(200)
  const editedTask = f.runtime.services.store.task(edited.id)
  const editedFile = [
    ...editedTask.messages.filter((message) => message.role === 'user'),
    ...(editedTask.queue ?? []),
  ][0]?.attachments?.[0]
  const editedText = Buffer.from(
    f.runtime.services.attachments.read(edited.id, editedFile?.id ?? '').data,
    'base64',
  ).toString('utf8')
  expect(editedText).not.toContain(deviceToken)

  const project = await f.request('/api/problem-reports/start', {
    ...problemReportStart(
      input,
      preview,
      { ...draft(), repositoryId: 'some-project' },
      randomUUID(),
    ),
  })
  expect(project.status).toBe(400)
})
