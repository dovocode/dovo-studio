import { startRuntime } from '../packages/runtime/dist/index.js'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'

const directory = await mkdtemp(join(tmpdir(), 'dovo-unified-web-'))
const artifacts = resolve(process.env.DOVO_VERIFY_OUTPUT ?? 'work/design/unified-views')
await mkdir(artifacts, { recursive: true })
const log = []
const processes = []
const runtimes = []
let socket
let evaluate
let send
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (condition, message) => {
  if (!condition) throw new Error(message)
}

async function fixture(name) {
  const token = randomBytes(32).toString('base64url')
  const checkout = join(directory, name)
  await mkdir(checkout)
  execFileSync('git', ['init', '-q', checkout])
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: token,
    host: '127.0.0.1',
    port: 0,
  })
  runtimes.push(runtime)
  runtime.services.commands.save({
    ...runtime.services.commands.get(),
    codex: resolve('scripts/fixtures/codex.cjs'),
    gh: resolve('scripts/fixtures/github.cjs'),
  })
  const project = {
    id: 'same-repo',
    name: `${name} project`,
    path: checkout,
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
  }
  runtime.services.forges.save({
    provider: 'github',
    name: `${name} account`,
    baseUrl: 'https://github.com',
    credential: 'gh',
  })
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: [project],
    jiraSources: [
      {
        id: 'same-jira',
        name: `${name} Jira`,
        site: `https://${name.toLowerCase()}-fixture.atlassian.net`,
        project: 'TEAM',
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
    tasks: [
      {
        id: 'same-task',
        title: `${name} task`,
        repositoryId: project.id,
        agentId: '',
        status: 'draft',
        createdAt: '2026-09-20T12:00:00Z',
        messages: [],
        files: [],
        draft: '',
        example: false,
      },
    ],
    automations: [
      { id: 'same-automation', name: `${name} automation`, nodes: [], edges: [], enabled: false },
    ],
  }))
  const pull = {
    number: 1,
    title: `${name} pull request`,
    url: `https://github.com/fixture/${name}/pull/1`,
    state: 'open',
    draft: false,
    author: 'developer',
    updatedAt: '2026-09-20T12:00:00Z',
    head: 'feature',
    base: 'main',
    labels: [],
    viewerReviewRequested: true,
  }
  const reads = []
  const controls = { replacePull: false, issueReads: 0 }
  runtime.services.pullCache.list = async (_cwd, _state, page) => ({
    pulls:
      page === 1
        ? [
            controls.replacePull
              ? {
                  ...pull,
                  number: 3,
                  title: `${name} refreshed PR`,
                  url: pull.url.replace('/1', '/3'),
                }
              : pull,
          ]
        : [{ ...pull, number: 2, title: `${name} older PR`, url: pull.url.replace('/1', '/2') }],
    hasMore: page === 1,
    page,
  })
  runtime.services.pullCache.detail = async () => {
    reads.push('pull-detail')
    return {
      pull: {
        ...pull,
        body: `## ${name} details\n\nFixture markdown.`,
        headSha: 'a'.repeat(40),
        baseSha: 'b'.repeat(40),
        repositoryUrl: `https://github.com/fixture/${name}`,
        additions: 1,
        deletions: 0,
        changedFiles: 0,
        mergeable: true,
        reviewers: [],
        assignees: [],
      },
      comments: [],
      files: [],
      checks: [],
      warnings: [],
    }
  }
  const issue = {
    id: '1',
    title: `${name} issue`,
    body: `${name} issue details`,
    state: 'open',
    type: 'Issue',
    url: `https://github.com/fixture/${name}/issues/1`,
    author: 'developer',
    assignees: [],
    labels: [],
    updatedAt: '2026-09-20T12:00:00Z',
    revision: '1',
    bodyFormat: 'markdown',
  }
  const pipeline = {
    id: '1',
    title: `${name} pipeline`,
    url: `https://github.com/fixture/${name}/actions/runs/1`,
    ref: 'main',
    sha: 'a'.repeat(40),
    actor: 'developer',
    status: 'failure',
    createdAt: '2026-09-20T12:00:00Z',
    updatedAt: '2026-09-20T12:00:00Z',
    definition: '1',
    number: '1',
  }
  runtime.services.forgeWork.request = async (_repository, operation, input) => {
    reads.push(operation)
    if (operation === 'options')
      return {
        provider: 'github',
        issues: true,
        issueTypes: ['Issue'],
        issueStates: ['open', 'closed'],
        assignees: true,
        labels: true,
        pipelines: true,
        pipelineActions: [],
      }
    if (operation === 'issues/list') {
      controls.issueReads++
      return input.cursor
        ? {
            items: [
              {
                ...issue,
                id: '2',
                title: `${name} older issue`,
                url: issue.url.replace('/1', '/2'),
              },
            ],
          }
        : { items: [issue], next: 'second' }
    }
    if (operation === 'issues/detail') return { issue, comments: [] }
    if (operation === 'pipelines/list')
      return {
        items: [
          pipeline,
          {
            ...pipeline,
            id: '2',
            title: `${name} unrelated pipeline`,
            sha: 'c'.repeat(40),
            url: pipeline.url.replace('/1', '/2'),
          },
        ],
      }
    if (operation === 'pipelines/detail') return { run: pipeline, jobs: [] }
    throw new Error('Unexpected fixture operation ' + operation)
  }
  const jiraIssue = {
    ...issue,
    id: 'TEAM-1',
    title: `${name} Jira issue`,
    body: `${name} independent Jira details`,
    state: 'To Do',
    type: 'Task',
    url: `https://${name.toLowerCase()}-fixture.atlassian.net/browse/TEAM-1`,
  }
  runtime.services.forgeWork.requestJira = async (sourceId, operation, input) => {
    check(sourceId === 'same-jira', 'Jira request lost its independent source')
    check(!input.repositoryId, 'Jira read was coupled to a repository')
    reads.push(`jira/${operation}`)
    if (operation === 'options')
      return {
        provider: 'jira',
        issues: true,
        issueTypes: ['Task'],
        issueStates: [],
        assignees: true,
        labels: true,
        pipelines: false,
        pipelineActions: [],
      }
    if (operation === 'issues/list') return { items: [jiraIssue] }
    if (operation === 'issues/detail') return { issue: jiraIssue, comments: [] }
    throw new Error('Unexpected Jira fixture operation ' + operation)
  }
  // Give fixtures distinct hostnames while retaining the real authentication/routes/store.
  const proxy = createServer(async (request, response) => {
    try {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const headers = { ...request.headers }
      delete headers.host
      delete headers.connection
      delete headers['content-length']
      const value = await fetch(`http://127.0.0.1:${runtime.port}${request.url}`, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.concat(chunks),
      })
      const body = await value.text()
      const output =
        request.method === 'GET' && request.url === '/api/snapshot' && value.ok
          ? JSON.stringify({ ...JSON.parse(body), runtimeHost: name })
          : body
      const resultHeaders = Object.fromEntries(value.headers)
      delete resultHeaders['content-length']
      delete resultHeaders['transfer-encoding']
      delete resultHeaders['content-encoding']
      response.writeHead(value.status, resultHeaders)
      response.end(output)
    } catch (error) {
      log.push({ proxyError: String(error), method: request.method })
      response.writeHead(502)
      response.end(String(error))
    }
  })
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  const address = `http://127.0.0.1:${proxy.address().port}`
  const stopProxy = async () => {
    proxy.closeAllConnections()
    await new Promise((resolve) => proxy.close(resolve))
  }
  cleanups.push(stopProxy)
  const probe = await fetch(`${address}/api/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const probeSnapshot = await probe.json()
  check(
    probe.ok && probeSnapshot.runtimeHost === name,
    'Fixture proxy did not serve authenticated snapshot',
  )
  const preflight = await fetch(`${address}/api/snapshot`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1:4173',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization',
    },
  })
  check(
    preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === '*',
    `Fixture preflight failed: ${preflight.status} ${await preflight.text()}`,
  )
  return {
    profile: { id: address, name, connection: { address, token } },
    reads,
    services: runtime.services,
    controls,
    stopProxy,
  }
}

function launch(command, args, key) {
  const child = spawn(command, args, {
    detached: true,
    stdio: key === 'chrome' ? 'ignore' : ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', (chunk) => {
    output = (output + chunk).slice(-12000)
  })
  child.stderr?.on('data', (chunk) => {
    output = (output + chunk).slice(-12000)
  })
  processes.push({ child, key, output: () => output })
  return child
}
const cleanups = []
try {
  const first = await fixture('Mac')
  const second = await fixture('Linux')
  const portServer = createServer()
  await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve))
  const webPort = portServer.address().port
  await new Promise((resolve) => portServer.close(resolve))
  const webURL = `http://127.0.0.1:${webPort}`
  launch(
    'pnpm',
    ['--filter', '@dovo/web', 'dev', '--host', '127.0.0.1', '--port', String(webPort)],
    'vite',
  )
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(webURL)).ok) break
    } catch {}
    if (attempt === 150) throw new Error('Vite failed to start')
    await pause(200)
  }
  const chromeProfile = join(directory, 'chrome')
  launch(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-extensions',
      '--remote-debugging-port=0',
      `--user-data-dir=${chromeProfile}`,
      'about:blank',
    ],
    'chrome',
  )
  let debuggerPort
  for (let attempt = 0; ; attempt++) {
    try {
      debuggerPort = (await readFile(join(chromeProfile, 'DevToolsActivePort'), 'utf8')).split(
        '\n',
      )[0]
      break
    } catch {}
    if (attempt === 100) throw new Error('Chrome debugger failed to start')
    await pause(100)
  }
  const targets = await (await fetch(`http://127.0.0.1:${debuggerPort}/json/list`)).json()
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  let id = 0
  const calls = new Map()
  socket.onmessage = ({ data }) => {
    const value = JSON.parse(String(data))
    const call = calls.get(value.id)
    if (call) {
      calls.delete(value.id)
      if (value.error) call.reject(new Error(JSON.stringify(value.error)))
      else call.resolve(value.result)
    }
    if (value.method === 'Runtime.exceptionThrown')
      log.push({
        exception:
          value.params.exceptionDetails.exception?.description ??
          value.params.exceptionDetails.text,
      })
    if (value.method === 'Log.entryAdded' && value.params.entry.level === 'error')
      log.push({ browserError: value.params.entry.text })
    if (value.method === 'Network.loadingFailed' && value.params.errorText !== 'net::ERR_ABORTED')
      log.push({
        networkError: value.params.errorText,
        blockedReason: value.params.blockedReason,
        cors: value.params.corsErrorStatus,
      })
  }
  send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const callId = ++id
      calls.set(callId, { resolve, reject })
      socket.send(JSON.stringify({ id: callId, method, params }))
    })
  evaluate = async (expression) => {
    const value = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (value.exceptionDetails)
      throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text)
    return value.result.value
  }
  const wait = async (expression, label = expression) => {
    for (let attempt = 0; attempt < 360; attempt++) {
      if (await evaluate(expression)) return
      await pause(125)
    }
    throw new Error(`Timeout: ${label}\n${await evaluate('document.body.innerText')}`)
  }
  const click = async (label, contains = false, scope = 'document') => {
    const selector = `[...${scope}.querySelectorAll('button')].find(button => ${contains ? `button.innerText.includes(${JSON.stringify(label)})` : `button.getAttribute('aria-label') === ${JSON.stringify(label)} || button.innerText.trim() === ${JSON.stringify(label)}`})`
    await wait(`!!(${selector})`, `button ${label}`)
    await evaluate(`(${selector}).click()`)
  }
  const tab = (label) => click(label, false, `document.querySelector('[aria-label="Extensions"]')`)
  const input = async (label, value) =>
    evaluate(
      `(() => {const input=document.querySelector('[aria-label=${JSON.stringify(label)}]') || [...document.querySelectorAll('label')].find(label=>label.childNodes[0]?.textContent.trim()===${JSON.stringify(label)})?.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    )
  const has = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`
  const active = () => evaluate(`JSON.parse(localStorage.getItem('dovo.runtimes.v1')).activeId`)
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const registry = {
    version: 1,
    activeId: first.profile.id,
    profiles: [first.profile, second.profile],
  }
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `if(location.origin===${JSON.stringify(webURL)}&&!localStorage.getItem('dovo.runtimes.v1'))localStorage.setItem('dovo.runtimes.v1',${JSON.stringify(JSON.stringify(registry))});`,
  })
  await send('Page.navigate', { url: webURL })
  await wait(has('Mac task'))
  await wait(has('Linux task'))
  check(
    !(await evaluate(`!!document.querySelector('[aria-label="Active runtime"]')`)),
    'Global runtime picker remains',
  )
  await click('Linux task', true, `document.querySelector('[aria-label="Task sidebar"]')`)
  await wait(`document.querySelector('h1')?.textContent === 'Linux task'`)
  check((await active()) === second.profile.id, 'Task did not activate its owning runtime')
  await wait(has('Mac task'))
  log.push({
    check: 'tasks: both hosts, colliding IDs and automatic owner activation',
    passed: true,
  })

  check(
    !(await evaluate(
      `[...document.querySelectorAll('[aria-label="Extensions"] button')].some(button=>button.getAttribute('aria-label')==='Pipelines'||button.innerText.trim()==='Pipelines')`,
    )),
    'Pipelines remains in main navigation',
  )
  const checkPullPipeline = async (runtime, name) => {
    await click('Checks (0)')
    const section = `document.querySelector('[aria-label="Pull request pipeline runs"]')`
    await wait(`${section}?.innerText.includes(${JSON.stringify(`${name} pipeline`)})`)
    check(
      !(await evaluate(`${section}.innerText.includes('unrelated pipeline')`)),
      'PR checks included a run from another commit on the same branch',
    )
    await click(`${name} pipeline`, true, section)
    await wait(`!!document.querySelector('[aria-label="Pipeline details"]')`)
    check((await active()) === runtime.profile.id, 'Pipeline detail changed its PR owner')
    check(runtime.reads.includes('pipelines/detail'), 'Pipeline detail missed its PR owner')
    await click('Back to pipelines')
    await wait(`${section}?.innerText.includes(${JSON.stringify(`${name} pipeline`)})`)
    check(
      await evaluate(`!!document.querySelector('[aria-label="Pull request details"]')`),
      'Back from pipeline left its PR details',
    )
    log.push({
      check: `${name} PR: embedded exact-commit pipelines, owner detail and Back to checks`,
      passed: true,
    })
  }

  await tab('Pull requests')
  await wait(has('Mac pull request'))
  await wait(has('Linux pull request'))
  await input('Search pull requests', 'Mac')
  await click('Mac pull request', true)
  await wait(
    `!!document.querySelector('[aria-label="Pull request details"]') && ${has('Mac details')}`,
  )
  check(
    (await active()) === first.profile.id && first.reads.includes('pull-detail'),
    'PR detail read wrong owner',
  )
  await checkPullPipeline(first, 'Mac')
  await click('Back to PRs')
  await wait(`document.querySelector('[aria-label="Search pull requests"]')?.value === 'Mac'`)
  await input('Search pull requests', '')
  await wait(has('Linux pull request'))
  log.push({ check: 'PRs: both hosts, owner detail and retained search', passed: true })
  await click('Linux pull request', true)
  await wait(
    `!!document.querySelector('[aria-label="Pull request details"]') && ${has('Linux details')}`,
  )
  await checkPullPipeline(second, 'Linux')
  await click('Back to PRs')
  await wait(has('Mac pull request'))
  await click('Load more · Mac project', true)
  await wait(has('Mac older PR'))
  first.controls.replacePull = true
  await wait(has('Mac refreshed PR'))
  check(
    !(await evaluate(has('Mac pull request'))),
    'Removed first-page PR remained in polled collection',
  )
  check(await evaluate(has('Mac older PR')), 'Polling discarded older PR page')
  first.controls.replacePull = false
  log.push({
    check: 'PR polling retains loaded page two and removes old first-page records',
    passed: true,
  })

  for (const [label, singular, detailOperation] of [['Issues', 'issue', 'issues/detail']]) {
    await tab(label)
    await wait(has(`Mac ${singular}`))
    await wait(has(`Linux ${singular}`))
    await input(`Search ${label.toLowerCase()}`, 'Linux')
    await click(`Linux ${singular}`, true)
    await wait(
      `!![...document.querySelectorAll('button')].find(button=>button.innerText.includes('Back to ${label.toLowerCase()}'))`,
    )
    await wait(has(`Linux ${singular}`))
    check((await active()) === second.profile.id, `${label} did not activate remote owner`)
    for (let attempt = 0; attempt < 50 && !second.reads.includes(detailOperation); attempt++)
      await pause(100)
    check(second.reads.includes(detailOperation), `${label} did not request remote detail`)
    await click(`Back to ${label.toLowerCase()}`)
    await wait(
      `document.querySelector('[aria-label="Search ${label.toLowerCase()}"]')?.value === 'Linux'`,
    )
    await input(`Search ${label.toLowerCase()}`, '')
    await wait(has(`Mac ${singular}`))
    if (singular === 'issue') {
      await click('Load more · Mac project', true)
      await wait(has('Mac older issue'))
      check(
        !(await evaluate(
          `[...document.querySelectorAll('button')].some(button=>button.innerText.includes('Load more · Mac project'))`,
        )),
        'Last issue page left a repeatable Load more cursor',
      )
      const issueReads = first.controls.issueReads
      for (let attempt = 0; attempt < 360 && first.controls.issueReads <= issueReads; attempt++)
        await pause(125)
      check(first.controls.issueReads > issueReads, 'Issue polling did not run')
      await pause(300)
      check(await evaluate(has('Mac older issue')), 'Issue polling discarded page two')
      log.push({ check: 'Issue polling retains loaded page two', passed: true })
    }
    log.push({ check: `${label}: both hosts, colliding IDs and remote detail`, passed: true })
  }

  await wait(has('Mac Jira issue'))
  await wait(has('Linux Jira issue'))
  await click('Linux Jira issue', true)
  await wait(has('Linux independent Jira details'))
  check((await active()) === second.profile.id, 'Jira detail did not activate its source owner')
  check(second.reads.includes('jira/issues/detail'), 'Jira detail missed its independent source')
  check(
    await evaluate(
      `document.querySelector('[aria-label="Linked Dovo project"]')?.dataset.value === ''`,
    ),
    'Independent Jira issue was linked to a code project by default',
  )
  await click('Back to issues')
  await wait(has('Mac Jira issue'))
  await wait(has('Mac issue'))
  log.push({
    check:
      'independent Jira sources: both hosts, colliding source IDs, owner detail and native issues retained',
    passed: true,
  })

  await tab('Automations')
  await wait(has('Mac automation'))
  await wait(has('Linux automation'))
  await input('Search automations', 'Mac')
  await click('Mac automation', true)
  await wait(
    `!![...document.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')==='Back to automations'||button.innerText.includes('Back to automations'))`,
  )
  await wait(
    `JSON.parse(localStorage.getItem('dovo.runtimes.v1')).activeId === ${JSON.stringify(first.profile.id)}`,
  )
  await click('Back to automations')
  await wait(`document.querySelector('[aria-label="Search automations"]')?.value === 'Mac'`)
  await input('Search automations', '')
  await wait(has('Linux automation'))
  log.push({ check: 'automations: both hosts and remote owner detail', passed: true })

  await tab('Settings')
  const settings = (label) =>
    click(label, false, `document.querySelector('[aria-label="Settings sections"]')`)
  await settings('Agents')
  await wait(has('Mac agent'))
  await wait(has('Linux agent'))
  check(await evaluate(has('All computers')), 'Settings still describes a selected computer')
  const activeBeforeSettings = await active()
  await click('Configure', false, `document.querySelector('[aria-label="Agents on Linux"]')`)
  await input('Name', 'Linux edited agent')
  await click('Save configuration')
  await wait(has('Linux edited agent'))
  check(
    first.services.store.get().agents[0].name === 'Mac agent',
    'Remote agent save changed the first host',
  )
  check(
    second.services.store.get().agents[0].name === 'Linux edited agent',
    'Remote agent save missed its owner',
  )
  check((await active()) === activeBeforeSettings, 'Editing settings switched the active computer')
  log.push({
    check: 'agents: both hosts, colliding IDs and owner-only edit without runtime switch',
    passed: true,
  })

  await settings('MCP & skills')
  await wait(has('Project · Mac project'))
  await wait(has('Project · Linux project'))
  check(
    !(await evaluate(`!!document.querySelector('[aria-label="Resource scope"]')`)),
    'Resources still require scope switching',
  )
  const tool = `document.querySelector('[aria-label="Resources on Linux"] [aria-label="Enable MCP same-tool"]')`
  await evaluate(`(${tool}).click()`)
  await wait(`(${tool})?.getAttribute('aria-checked') === 'false'`)
  check(
    first.services.store.get().repositories[0].resources.mcpServers[0].enabled,
    'Resource edit changed wrong host',
  )
  check(
    !second.services.store.get().repositories[0].resources.mcpServers[0].enabled,
    'Remote resource was not saved',
  )
  log.push({
    check: 'resources: every scope is visible and edits stay with owning computer',
    passed: true,
  })

  await settings('Source control')
  await wait(has('Mac account'))
  await wait(has('Linux account'))
  await click('Edit', false, `document.querySelector('[aria-label="Accounts on Linux"]')`)
  await input('Connection name', 'Linux edited account')
  await click('Save connection')
  await wait(has('Linux edited account'))
  check(
    first.services.forges.list()[0].name === 'Mac account',
    'Connection edit changed wrong host',
  )
  check(
    second.services.forges.list()[0].name === 'Linux edited account',
    'Connection edit missed owner',
  )
  log.push({ check: 'accounts: all hosts and owner-only edit', passed: true })

  await settings('Devices & runtime')
  await click('Manage Linux')
  await click('CLI commands & shell')
  await wait(`!!document.querySelector('[aria-label="Bitbucket CLI executable (gildas)"]')`)
  await input('Bitbucket CLI executable (gildas)', '/fixture/linux-bb')
  await click('Save command settings')
  await wait(has('Command settings saved.'))
  check(
    second.services.commands.get().bb === '/fixture/linux-bb',
    'Device commands missed selected owner',
  )
  check(first.services.commands.get().bb === 'bb', 'Device commands changed unrelated computer')
  check((await active()) === activeBeforeSettings, 'Managing device switched execution context')
  await click('Close')
  log.push({
    check: 'devices: owner-specific command settings without switching workspace',
    passed: true,
  })
  const settingsShot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  })
  await writeFile(
    join(artifacts, 'web-unified-settings.png'),
    Buffer.from(settingsShot.data, 'base64'),
  )

  await second.stopProxy()
  cleanups.pop()
  await click('Reconnect Linux')
  await wait(has('Offline'))
  check((await active()) === activeBeforeSettings, 'Failed reconnect changed the active computer')
  log.push({
    check: 'failed per-device reconnect preserves other host and cached workspace',
    passed: true,
  })
  await tab('Overview')
  await click('Refresh devices')
  await wait(has('Offline'))
  await click(
    'Browse all pull requests',
    false,
    `document.querySelector('[aria-label="Computer Linux"]')`,
  )
  await wait(has('Mac pull request'))
  check(
    (await active()) === activeBeforeSettings,
    'Overview navigation switched to an offline computer',
  )
  log.push({
    check: 'overview opens unified PRs from offline host without a runtime switch',
    passed: true,
  })
  await tab('Tasks')
  await wait(has('Mac task'))
  await wait(has('Linux task'))
  await wait(has('Offline · Cached'))
  await tab('Pull requests')
  await wait(has('Mac pull request'))
  await wait(has('Linux pull request'))
  await wait(has('Offline'))
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  })
  await writeFile(join(artifacts, 'web-unified-pulls.png'), Buffer.from(screenshot.data, 'base64'))
  log.push({ check: 'offline host keeps cached rows without clearing online host', passed: true })
  await tab('Settings')
  await settings('Agents')
  await wait(has('Linux edited agent'))
  await wait(has('Mac agent'))
  await settings('Source control')
  await wait(has('Linux edited account'))
  await wait(has('Mac account'))
  await wait(has('Offline · Showing saved accounts'))
  log.push({
    check: 'offline settings retain agents and cached accounts across navigation',
    passed: true,
  })

  check(!log.some((entry) => entry.exception), 'Browser raised JavaScript exceptions')
  await writeFile(join(artifacts, 'web-smoke.json'), JSON.stringify(log, null, 2))
  console.log(JSON.stringify(log, null, 2))
} catch (error) {
  log.push({ failed: String(error) })
  if (send && evaluate) {
    const screenshot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    }).catch(() => null)
    if (screenshot)
      await writeFile(join(artifacts, 'web-failure.png'), Buffer.from(screenshot.data, 'base64'))
    log.push({ page: await evaluate('document.body.innerText').catch(String) })
  }
  await writeFile(join(artifacts, 'web-smoke.json'), JSON.stringify(log, null, 2))
  console.error(error)
  for (const process of processes) console.error(process.key, process.output())
  process.exitCode = 1
} finally {
  socket?.close()
  for (const { child } of processes.reverse()) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {}
    if (child.exitCode === null && child.signalCode === null)
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), pause(3000)])
  }
  for (const close of cleanups.reverse()) await close().catch(() => {})
  for (const runtime of runtimes) await runtime.close()
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
