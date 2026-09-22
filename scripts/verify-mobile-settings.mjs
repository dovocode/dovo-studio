import { startRuntime } from '../packages/runtime/dist/index.js'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'

const device = process.argv[2]
if (!device) throw new Error('Pass an isolated simulator UUID with the native app installed')
const directory = await mkdtemp(join(tmpdir(), 'dovo-mobile-settings-'))
const artifacts = resolve('work/design/unified-everywhere/mobile')
await mkdir(artifacts, { recursive: true })
const runtimes = []
const check = (condition, message) => {
  if (!condition) throw new Error(message)
}
async function fixture(name) {
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: randomBytes(32).toString('base64url'),
    host: '127.0.0.1',
    port: 0,
  })
  runtimes.push(runtime)
  runtime.services.commands.save({
    ...runtime.services.commands.get(),
    codex: resolve('scripts/fixtures/codex.cjs'),
    gh: resolve('scripts/fixtures/github.cjs'),
  })
  const path = join(directory, name)
  await mkdir(path)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: [
      {
        id: 'same-repo',
        name: `${name} project`,
        path,
        branch: 'main',
        resources: {
          mcpServers: [
            {
              name: 'same-tool',
              transport: 'stdio',
              command: 'node',
              args: [],
              env: {},
              enabled: true,
            },
          ],
          skills: [],
        },
      },
    ],
    agents: [
      {
        id: 'same-agent',
        name: `${name} agent`,
        provider: 'codex',
        model: '',
        endpoint: '',
        instructions: '',
        permission: 'ask',
      },
    ],
    tasks: [],
    automations: [],
  }))
  runtime.services.forges.save({
    provider: 'github',
    name: `${name} account`,
    baseUrl: 'https://github.com',
    credential: 'gh',
  })
  runtime.services.pullCache.list = async () => ({ pulls: [], hasMore: false, page: 1 })
  return runtime
}
const native = (flow) =>
  flow.replace(
    /^(\s*)id: Tab (.+)$/gm,
    (_match, indent, label) =>
      `${indent}text: ${label}\n${indent}childOf:\n${indent}  text: Tab Bar`,
  )
async function flow(name, text, environment = {}) {
  const path = join(artifacts, `${name}.yaml`)
  await writeFile(path, native(text))
  console.log(`Running ${name}`)
  const child = spawn(
    'maestro',
    [
      '--device',
      device,
      'test',
      ...Object.entries(environment).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      path,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], cwd: artifacts },
  )
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk
    process.stdout.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
    process.stderr.write(chunk)
  })
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  await writeFile(join(artifacts, `${name}.log`), output)
  if (status !== 0) throw new Error(`Native settings verification failed: ${name}`)
}
try {
  const first = await fixture('First'),
    second = await fixture('Second')
  for (const name of ['open-settings', 'open-devices', 'reset-computers'])
    await writeFile(
      join(artifacts, `${name}.yaml`),
      native(await readFile(`apps/mobile/maestro/${name}.yaml`, 'utf8')),
    )
  await flow('reset', 'appId: com.dovo.studio\n---\n- launchApp\n- runFlow: reset-computers.yaml\n')
  for (const { name, file, runtime, prefix } of [
    { name: 'pair-first', file: 'multi-device-first', runtime: first, prefix: 'FIRST' },
    { name: 'pair-second', file: 'multi-device', runtime: second, prefix: 'SECOND' },
  ]) {
    const yaml = await readFile(`apps/mobile/maestro/${file}.yaml`, 'utf8')
    await flow(name, yaml.slice(0, yaml.indexOf('- tapOn:\n    id: Tab Tasks')), {
      [`${prefix}_ADDRESS`]: `http://127.0.0.1:${runtime.port}`,
      [`${prefix}_CODE`]: runtime.services.pairing.createCode(true).code,
    })
  }
  await flow(
    'agents',
    `appId: com.dovo.studio
---
- runFlow: open-settings.yaml
- tapOn: Agents
- assertNotVisible:
    id: Selected computer
- assertVisible: First agent
- scrollUntilVisible:
    element:
      text: Second agent
    direction: DOWN
- scrollUntilVisible:
    element:
      text: Edit First agent
    direction: UP
- tapOn: Edit First agent
- tapOn:
    id: Name
- eraseText
- inputText: First edited agent
- tapOn: Dismiss keyboard
- scrollUntilVisible:
    element:
      text: Save agent
    direction: DOWN
- tapOn: Save agent
- extendedWaitUntil:
    visible: First edited agent
    timeout: 20000
- takeScreenshot: unified-agents
`,
  )
  check(
    first.services.store.get().agents[0].name === 'First edited agent',
    'Agent save missed owner',
  )
  check(
    second.services.store.get().agents[0].name === 'Second agent',
    'Agent save changed another computer',
  )
  if (!process.argv.includes('--creation-only')) {
    await flow(
      'resources',
      `appId: com.dovo.studio
---
- runFlow: open-settings.yaml
- tapOn: MCP & skills
- assertVisible: First project
- assertVisible: Second project
- assertNotVisible:
    id: Resource scope
- tapOn: First project
- extendedWaitUntil:
    visible: same-tool
    timeout: 10000
- tapOn:
    text: Enable MCP same-tool
- tapOn: Close
- takeScreenshot: unified-resources
`,
    )
    check(
      !first.services.store.get().repositories[0].resources.mcpServers[0].enabled,
      'Resource save missed owner',
    )
    check(
      second.services.store.get().repositories[0].resources.mcpServers[0].enabled,
      'Resource save changed another computer',
    )
    await flow(
      'accounts',
      `appId: com.dovo.studio
---
- runFlow: open-settings.yaml
- tapOn: Source control
- extendedWaitUntil:
    visible: First account
    timeout: 15000
- scrollUntilVisible:
    element:
      text: Second account
    direction: DOWN
- scrollUntilVisible:
    element:
      text: First account
    direction: UP
- tapOn: First account
- tapOn:
    id: Account name
- eraseText
- inputText: First edited account
- tapOn: Dismiss keyboard
- scrollUntilVisible:
    element:
      text: Save account
    direction: DOWN
- tapOn: Save account
- extendedWaitUntil:
    visible: First edited account
    timeout: 20000
- takeScreenshot: unified-accounts
`,
    )
    check(
      first.services.forges.list()[0].name === 'First edited account',
      'Account save missed owner',
    )
    check(
      second.services.forges.list()[0].name === 'Second account',
      'Account save changed another computer',
    )
    await flow(
      'devices',
      `appId: com.dovo.studio
---
- runFlow: open-devices.yaml
- tapOn: Manage First Mac
- assertNotVisible: Use First Mac
- tapOn: CLI commands & shell
- scrollUntilVisible:
    element:
      id: Bitbucket CLI executable.*
    direction: DOWN
- tapOn:
    id: Bitbucket CLI executable.*
- eraseText
- inputText: /fixture/first-bb
- tapOn: Dismiss keyboard
- scrollUntilVisible:
    element:
      text: Save command settings
    direction: DOWN
- tapOn: Save command settings
- extendedWaitUntil:
    visible: Command settings saved.
    timeout: 20000
- tapOn: Close
- takeScreenshot: unified-devices
`,
    )
    check(first.services.commands.get().bb === '/fixture/first-bb', 'Command save missed owner')
    check(second.services.commands.get().bb === 'bb', 'Command save changed another computer')
  }
  const newProject = join(directory, 'new-project')
  await mkdir(newProject)
  execFileSync('git', ['init', '-q', newProject])
  await flow(
    'project-creation',
    `appId: com.dovo.studio
---
- runFlow: open-settings.yaml
- tapOn:
    id: Tab Tasks
- tapOn: Projects
- tapOn: Add repository
- extendedWaitUntil:
    visible: Choose where this work should run.
    timeout: 15000
- tapOn: First Mac
- tapOn:
    id: Repository name
- inputText: Targeted project
- tapOn: Dismiss keyboard
- tapOn:
    id: Local path on runtime host
- inputText: ${newProject}
- tapOn: Dismiss keyboard
- tapOn: Add repository
- extendedWaitUntil:
    visible: Targeted project
    timeout: 20000
- takeScreenshot: unified-project-creation
`,
  )
  check(
    first.services.store.get().repositories.some((repo) => repo.name === 'Targeted project'),
    'Project creation missed the chosen computer',
  )
  check(
    !second.services.store.get().repositories.some((repo) => repo.name === 'Targeted project'),
    'Project creation used the previously active computer',
  )
  execFileSync('xcrun', [
    'simctl',
    'openurl',
    device,
    'dovo://task?text=Shortcut%20on%20the%20first%20computer',
  ])
  await flow(
    'shortcut',
    `appId: com.dovo.studio
---
- tapOn:
    text: Open
    optional: true
- extendedWaitUntil:
    visible: Choose where this work should run.
    timeout: 15000
- tapOn: First Mac
- extendedWaitUntil:
    visible: Shortcut on the first computer
    timeout: 20000
- takeScreenshot: unified-shortcut
`,
  )
  check(
    first.services.store
      .get()
      .tasks.some((task) => task.draft === 'Shortcut on the first computer'),
    'Shortcut did not create its draft on the chosen computer',
  )
  check(
    second.services.store.get().tasks.length === 0,
    'Shortcut created a draft on the previously active computer',
  )
  for (const runtime of runtimes.splice(0)) await runtime.close()
  await flow(
    'offline-overview',
    `appId: com.dovo.studio
---
- tapOn: Back
- tapOn:
    id: Device overview
- tapOn: 'First Mac, Offline,.*'
- assertVisible: Showing saved activity
- tapOn: Manage computers
- assertVisible:
    text: Settings
- tapOn:
    id: Devices & runtime
- assertVisible: Manage First Mac
- assertVisible: Manage Second Mac
- takeScreenshot: unified-offline-management
`,
  )
  console.log('PASS: unified native settings, explicit creation targets and offline navigation')
} finally {
  for (const runtime of runtimes) await runtime.close()
  await rm(directory, { recursive: true, force: true })
}
