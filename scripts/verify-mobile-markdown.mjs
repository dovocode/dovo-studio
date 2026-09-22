import { startRuntime } from '../packages/runtime/dist/index.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
const device = process.argv[2]
const inlineOnly = process.argv.includes('--inline-only')
if (!device) throw new Error('Pass a simulator UUID')
const originalContentSize = inlineOnly
  ? execFileSync('xcrun', ['simctl', 'ui', device, 'content_size'], { encoding: 'utf8' }).trim()
  : undefined
const inlineMarkdown = [
  '## Inline code',
  'Run `pnpm test`, then `git status`.',
  'Path: `apps/mobile/src/tasks/conversation-provider.tsx`.',
  'Token: `RemoteRuntimeConnectionCheckpointRestorationStrategy`.',
  '- Keep `draft.text`; pass `--watch`.',
  '| Key | Value |\n| --- | --- |\n| File | `src/runtime.ts` |',
].join('\n\n')
const directory = await mkdtemp(join(tmpdir(), 'dovo-markdown-'))
const runtime = await startRuntime({
  databasePath: ':memory:',
  ownerToken: randomBytes(32).toString('base64url'),
  port: 0,
})
// Submit from outside the mobile client to verify remote turns never steal a
// reader's position. This control endpoint exists only in the local fixture.
const control = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/remote-turn') {
    response.writeHead(404).end()
    return
  }
  try {
    await runtime.services.tasks.send('markdown-task', randomUUID(), 'Markdown verification remote')
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ ok: true }))
  } catch (error) {
    response.writeHead(500).end(String(error))
  }
})
await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve))
const controlAddress = control.address()
if (!controlAddress || typeof controlAddress === 'string')
  throw new Error('Markdown fixture control endpoint did not start')
try {
  if (inlineOnly) execFileSync('xcrun', ['simctl', 'ui', device, 'content_size', 'large'])
  for (const args of [
    ['init', '-q'],
    ['config', 'user.name', 'Fixture'],
    ['config', 'user.email', 'fixture@example.invalid'],
    ['commit', '--allow-empty', '-m', 'Fixture'],
  ])
    execFileSync('git', args, { cwd: directory })
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: [
      { id: 'markdown-repo', name: 'Mobile fixture', path: directory, branch: 'main' },
    ],
    agents: [
      {
        id: 'markdown-agent',
        name: 'Codex',
        provider: 'codex',
        model: '',
        endpoint: '',
        instructions: '',
        permission: 'ask',
      },
    ],
    tasks: [
      {
        id: 'markdown-task',
        title: 'Markdown and device',
        createdAt: new Date().toISOString(),
        draft: '',
        example: false,
        repositoryId: 'markdown-repo',
        agentId: 'markdown-agent',
        status: 'review',
        objective: '',
        files: [],
        messages: [
          {
            id: 'markdown-response',
            role: 'assistant',
            text: inlineOnly
              ? inlineMarkdown
              : '# Markdown preview\n\n**Bold**, *italic*, and [OpenAI](https://openai.com).\n\n- First item\n- Second item\n\n```ts\nconst answer = 42\n```\n\n| Device | State |\n| --- | --- |\n| build-mac | Ready |\n\n> Ready for review.',
          },
        ],
        turns: [
          {
            id: 'historical-turn',
            assistantId: 'markdown-response',
            agentId: 'markdown-agent',
            provider: 'codex',
            model: '',
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            status: 'completed',
            runtimeHost: 'build-mac',
          },
        ],
      },
    ],
  }))
  runtime.services.commands.save({
    ...runtime.services.commands.get(),
    codex: resolve('scripts/fixtures/codex.cjs'),
  })
  const runFlow = async (name) => {
    const child = spawn(
      'maestro',
      [
        '--device',
        device,
        'test',
        '-e',
        `RUNTIME_ADDRESS=http://127.0.0.1:${runtime.port}`,
        '-e',
        `PAIRING_CODE=${runtime.services.pairing.createCode(true).code}`,
        '-e',
        `CONTROL_ADDRESS=http://127.0.0.1:${controlAddress.port}`,
        resolve(`apps/mobile/maestro/${name}.yaml`),
      ],
      { stdio: 'inherit' },
    )
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    })
    if (result !== 0) throw new Error(`Markdown walkthrough failed (${result})`)
  }
  if (inlineOnly) {
    await runFlow('markdown-inline')
    verifyInlineBounds(device)
    execFileSync('xcrun', ['simctl', 'ui', device, 'content_size', 'extra-extra-extra-large'])
    await runFlow('markdown-inline-large')
    verifyInlineBounds(device)
    await runFlow('markdown-inline-finish')
    if (runtime.services.store.task('markdown-task').messages[0].text !== inlineMarkdown)
      throw new Error('Rendering inline code modified its Markdown source')
    console.log(
      'Native inline commands, paths, long tokens, punctuation, lists and tables verified at standard and XXXL text sizes.',
    )
  } else {
    await runFlow('markdown')
    const task = runtime.services.store.task('markdown-task')
    if (
      task.turns.at(-1)?.status !== 'completed' ||
      !task.turns.at(-1)?.runtimeHost ||
      !task.messages.at(-1)?.text.includes('Rendered reply')
    )
      throw new Error('Streamed Markdown turn was not completed and attributed')
    const prompts = task.messages.filter((message) => message.role === 'user')
    if (
      JSON.stringify(prompts.map((message) => message.text)) !==
      JSON.stringify([
        'Markdown verification',
        'Markdown verification remote',
        'Markdown verification local',
      ])
    )
      throw new Error('Expected initial, remote and local follow-up turns')
    console.log(
      'Native Markdown, full stream completion, keyboard following, remote reading position, local send and execution devices verified.',
    )
  }
} finally {
  if (originalContentSize)
    execFileSync('xcrun', ['simctl', 'ui', device, 'content_size', originalContentSize])
  control.closeAllConnections()
  await new Promise((resolve) => control.close(resolve))
  await runtime.close()
  await rm(directory, { recursive: true, force: true })
}

function verifyInlineBounds(device) {
  const tree = JSON.parse(
    execFileSync('maestro', ['--device', device, 'hierarchy', '--no-ansi'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    }),
  )
  const nodes = []
  const visit = (node) => {
    if (node.attributes) nodes.push(node.attributes)
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  const parse = (node) =>
    node?.bounds
      ?.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/)
      ?.slice(1)
      .map(Number)
  const window = parse(tree.children?.[0]?.attributes)
  if (!window) throw new Error('Missing native window bounds')
  for (const label of [
    'pnpm test',
    'RemoteRuntimeConnectionCheckpointRestorationStrategy',
    'src/runtime.ts',
  ]) {
    const matches = nodes.filter((node) =>
      `${node.text ?? ''} ${node.accessibilityText ?? ''}`.includes(label),
    )
    if (!matches.length) throw new Error(`Missing rendered inline code: ${label}`)
    for (const node of matches) {
      const values = parse(node)
      if (values && (values[0] < window[0] || values[2] > window[2]))
        throw new Error(`Inline code extends beyond the page: ${label}, ${node.bounds}`)
    }
  }
}
