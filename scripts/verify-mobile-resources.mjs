import { startRuntime } from '../packages/runtime/dist/index.js'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
const device = process.argv[2]
if (!device) throw new Error('Pass a simulator UUID with the current native app installed')
const directory = await mkdtemp(join(tmpdir(), 'dovo-mobile-resource-check-'))
const runtime = await startRuntime({
  databasePath: ':memory:',
  ownerToken: randomBytes(32).toString('base64url'),
  port: 0,
})
const originalFetch = globalThis.fetch
const sha = 'b'.repeat(40)
globalThis.fetch = async (input, options) => {
  const url = input instanceof Request ? input.url : input.toString()
  if (url.startsWith('https://registry.modelcontextprotocol.io/'))
    return Response.json({
      servers: [
        {
          server: {
            name: 'io.example/docs',
            description: 'Fixture MCP server',
            version: '1.0',
            remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
          },
        },
      ],
      metadata: {},
    })
  if (url.startsWith('https://skills.sh/api/search'))
    return Response.json({
      skills: [
        {
          id: 'fixture/repo/catalog-fixture',
          skillId: 'catalog-fixture',
          name: 'Catalog fixture',
          source: 'fixture/repo',
          installs: 12,
        },
      ],
    })
  if (url === 'https://api.github.com/repos/fixture/repo/commits/HEAD')
    return Response.json({ sha })
  if (url.startsWith('https://api.github.com/repos/fixture/repo/git/trees/'))
    return Response.json({
      truncated: false,
      tree: [{ path: 'skills/catalog-fixture/SKILL.md', type: 'blob', mode: '100644', size: 90 }],
    })
  if (url.startsWith('https://raw.githubusercontent.com/fixture/repo/'))
    return new Response(
      '---\nname: catalog-fixture\ndescription: Fixture instructions\n---\nReview changes.',
    )
  return originalFetch(input, options)
}
const approve = setInterval(() => {
  for (const request of runtime.services.pairing.pending())
    if (request.name === 'Dovo simulator test') runtime.services.pairing.approve(request.id, true)
}, 250)
try {
  for (const args of [
    ['init', '-q'],
    ['config', 'user.name', 'Fixture'],
    ['config', 'user.email', 'fixture@example.invalid'],
    ['commit', '--allow-empty', '-qm', 'Fixture'],
  ])
    execFileSync('git', args, { cwd: directory })
  await mkdir(join(directory, 'skill'))
  const skillPath = join(directory, 'skill', 'SKILL.md')
  await writeFile(
    skillPath,
    '---\nname: imported-mobile-skill\ndescription: Review from mobile\n---\nCheck the code.',
  )
  runtime.services.store.update((workspace) => ({
    ...workspace,
    agents: [
      {
        id: 'mobile-agent',
        name: 'Mobile agent',
        provider: 'codex',
        model: '',
        instructions: '',
        permission: 'ask',
        endpoint: '',
      },
    ],
    repositories: [{ id: 'mobile-repo', name: 'Mobile fixture', path: directory, branch: 'main' }],
    tasks: [],
  }))
  runtime.services.commands.save({
    ...runtime.services.commands.get(),
    codex: resolve('scripts/fixtures/codex.cjs'),
  })
  const child = spawn(
    'maestro',
    [
      '--device',
      device,
      'test',
      '-e',
      `RUNTIME_ADDRESS=http://127.0.0.1:${runtime.port}`,
      '-e',
      `PAIRING_CODE=${runtime.services.pairing.createCode().code}`,
      '-e',
      `SKILL_PATH=${skillPath}`,
      resolve('apps/mobile/maestro/resources.yaml'),
    ],
    { stdio: 'inherit' },
  )
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (result !== 0) throw new Error(`Mobile resource verification failed (${result})`)
  const workspace = runtime.services.store.get(),
    project = workspace.repositories[0].resources,
    agent = workspace.agents[0].resources,
    task = workspace.tasks[0]
  if (
    project?.skills.length !== 2 ||
    project.mcpServers.length !== 1 ||
    agent?.skills[0]?.name !== 'agent-review' ||
    agent.skills.length !== 1
  )
    throw new Error('Resource scopes did not persist independently')
  if (
    task.title !== 'Simplify task creation' ||
    task.messages[0]?.text !== 'Mobile first-message task' ||
    task.execution !== 'worktree' ||
    task.harness?.permission !== 'full-access'
  )
    throw new Error('First-message configuration was not retained')
  console.log(
    'Native resource editors, scoped persistence, both catalogs, model/access selection, worktree selection and generated first-message title verified.',
  )
} finally {
  clearInterval(approve)
  globalThis.fetch = originalFetch
  await runtime.close()
  await rm(directory, { recursive: true, force: true })
}
