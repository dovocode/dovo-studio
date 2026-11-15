// Opt-in live selection benchmark. All advertised MCP actions are mocks.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import {
  instructionCases,
  instructionTools,
  scoreInstructions,
  instructionFixture,
} from './model-instruction-cases.mjs'

export const cases = [
  {
    id: 'native',
    prompt:
      'Check the appearance of my installed iPhone app. You have not discovered any device IDs yet.',
    tool: 'devices',
  },
  {
    id: 'signed-in-browser',
    prompt:
      'Read the issue title in my currently signed-in Dovo Browser tab. No tab IDs are known yet.',
    tool: 'studio_browsers',
    action: 'list',
  },
  {
    id: 'isolated-browser',
    prompt:
      'Open https://example.test in an isolated browser to inspect its form. It needs no account or user cookies.',
    tool: 'browser',
    action: 'navigate',
    fields: { url: 'https://example.test' },
  },
  {
    id: 'pipeline',
    prompt:
      'Monitor https://github.com/example/project/actions/runs/123456 and tell me if it fails. Do not poll.',
    tool: 'pipeline_watch',
    action: 'watch',
    fields: { url: 'https://github.com/example/project/actions/runs/123456' },
    absent: ['runIds'],
  },
  {
    id: 'question',
    prompt:
      'Ask me to choose between SQLite and PostgreSQL before you make the database change. The code cannot decide my preference.',
    tool: 'ask_question',
  },
  {
    id: 'review-workflow',
    prompt:
      'Show me a review card to run one of my saved workflows. I do not know its ID. Do not start it automatically.',
    tool: 'automation_list',
  },
  {
    id: 'review-thread',
    prompt:
      'Prepare a new agent conversation for me to review and send later. Its prompt should be "Review my API design". Do not start any work.',
    tool: 'thread_prepare',
    fields: { prompt: 'Review my API design' },
  },
  {
    id: 'memory',
    prompt:
      'Find my saved system Memory note about the release checklist. You do not know its key. Do not search repository files.',
    tool: 'memory_list',
    fields: { scope: 'system' },
  },
  {
    id: 'help',
    prompt: 'How does this installed Dovo version handle queued messages? Find its own help.',
    tool: 'dovo_help',
    action: 'search',
  },
  {
    id: 'quoted-response',
    prompt:
      'Read the full assistant response attached to my reply. Its messageId is reply-42. The short quote is not enough.',
    tool: 'conversation_read',
    fields: { messageId: 'reply-42' },
  },
  {
    id: 'private-input',
    prompt:
      'I need to enter a password. Request private input for the reviewed local command /usr/bin/true which accepts stdin. Never ask for the value in chat.',
    tool: 'secure_input',
    action: 'request',
    fields: { 'destination.kind': 'command', 'destination.command': '/usr/bin/true' },
  },
  {
    id: 'checklist',
    prompt:
      "Read this conversation's shared task checklist before updating progress. Do not create another list.",
    tool: 'todos',
    action: 'list',
  },
  {
    id: 'known-workflow',
    prompt:
      'Prepare a human review card for the saved workflow whose id is workflow-42. Do not run it.',
    tool: 'automation_prepare',
    fields: { automationId: 'workflow-42' },
  },
  {
    id: 'rename-terminal',
    prompt:
      'Rename the terminal you opened in this tool session, id terminal-42, to Build logs. Keep its shell running.',
    tool: 'terminal_rename',
    fields: { id: 'terminal-42', title: 'Build logs' },
  },
  { id: 'no-tool', prompt: 'What is 17 plus 25? Answer directly. Do not use tools.', tool: null },
  {
    id: 'enough-context',
    prompt:
      'The full response is already here: "The default interface language is English." Which language is the default? Answer from this text without reading history or using a tool.',
    tool: null,
  },
]

export function score(test, calls, error) {
  const first = calls[0]
  const input = first?.tool?.startsWith('studio_')
    ? (first.input?.command ?? first.input)
    : first?.input
  const selected = (first?.tool ?? null) === test.tool
  const valid = test.tool === null ? calls.length === 0 : first?.valid === true
  const argumentsMatch =
    (!test.action || input?.action === test.action) &&
    Object.entries(test.fields ?? {}).every(
      ([key, value]) => key.split('.').reduce((value, part) => value?.[part], input) === value,
    ) &&
    (test.absent ?? []).every((key) => !Object.hasOwn(input ?? {}, key))
  return {
    id: test.id,
    expected: test.tool,
    actual: first?.tool ?? null,
    input: first?.input ?? null,
    selected,
    valid,
    correct: !error && selected && valid && argumentsMatch,
    singleAction: calls.length <= 1,
    calls: calls.length,
    ...(error ? { error } : {}),
  }
}

export function captureOptions(args) {
  const allTools = args.includes('--all-tools')
  const instructions =
    args.includes('--suite') && args[args.indexOf('--suite') + 1] === 'instructions'
  return {
    memoryScopes:
      allTools || instructions ? ['system', 'project', 'projectless', 'bot'] : ['system'],
    select: (tools) =>
      instructions && !allTools
        ? tools.filter((tool) => instructionTools.includes(tool.name))
        : tools,
  }
}

export function providerGateEnvironment(model, baseURL, inherited = {}) {
  const url = new URL(baseURL)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Provider gate must be an HTTP loopback URL')
  const provider = model.split('/')[0]
  const config = JSON.parse(inherited.OPENCODE_CONFIG_CONTENT || '{}')
  const previous = config.providers?.[provider]
  return {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...config,
      providers: {
        ...config.providers,
        [provider]: { ...previous, settings: { ...previous?.settings, baseURL } },
      },
    }),
  }
}

async function main() {
  const args = process.argv.slice(2)
  const instructionSuite =
    args.includes('--suite') && args[args.indexOf('--suite') + 1] === 'instructions'
  const option = (name) => {
    const index = args.indexOf(name)
    if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error('Missing ' + name + ' value')
    return args[index + 1]
  }
  const require = createRequire(new URL('../packages/runtime/package.json', import.meta.url))
  if (args.includes('--mock')) {
    const { secureInputCommand } =
      await import('../packages/runtime/dist/agent-tools/secure-input-command.js')
    const { secureInputToolResult } =
      await import('../packages/runtime/dist/agent-tools/secure-input-result.js')
    const { linkedProjectCommand } =
      await import('../packages/runtime/dist/agent-tools/linked-project-command.js')
    const { responsePrepareCommand } =
      await import('../packages/runtime/dist/agent-tools/response-prepare-command.js')
    const { studioToolCommand } =
      await import('../packages/runtime/dist/studio/tool-definitions.js')
    const { workflowCommand } =
      await import('../packages/runtime/dist/agent-tools/workflow-command.js')
    const { terminalInputData } =
      await import('../packages/runtime/dist/agent-tools/terminal-input-command.js')
    const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
    const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
    const {
      ListToolsRequestSchema,
      CallToolRequestSchema,
    } = require('@modelcontextprotocol/sdk/types.js')
    const {
      AjvJsonSchemaValidator,
    } = require('@modelcontextprotocol/sdk/validation/ajv-provider.js')
    const validator = new AjvJsonSchemaValidator()
    const tools = JSON.parse(readFileSync(option('--mock'), 'utf8'))
    const records = option('--records')
    const validators = new Map(
      tools.map((tool) => [tool.name, validator.getValidator(tool.inputSchema)]),
    )
    const server = new Server(
      { name: 'selection-benchmark', version: '1' },
      { capabilities: { tools: {} } },
    )
    let activeScenario
    let fixtureState = {}
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const transportInput = request.params.arguments
      let input = transportInput
      let argumentError
      let valid = validators.get(request.params.name)?.(transportInput).valid === true
      if (valid && request.params.name === 'secure_input') {
        try {
          input = secureInputCommand(transportInput)
        } catch {
          valid = false
        }
      }
      if (valid && request.params.name === 'linked_projects') {
        try {
          input = linkedProjectCommand(transportInput)
        } catch {
          valid = false
        }
      }
      if (valid && request.params.name === 'response_prepare') {
        try {
          input = responsePrepareCommand(transportInput)
        } catch (error) {
          valid = false
          argumentError = error.message
        }
      }
      if (valid && request.params.name === 'workflow') {
        try {
          input = workflowCommand(transportInput)
        } catch (error) {
          valid = false
          argumentError = error.message
        }
      }
      if (valid && request.params.name === 'terminal_input') {
        try {
          input = { ...transportInput, data: terminalInputData(transportInput) }
        } catch (error) {
          valid = false
          argumentError = error.message
        }
      }
      if (
        valid &&
        request.params.name.startsWith('studio_') &&
        request.params.name !== 'studio_discover'
      ) {
        try {
          input = {
            ...transportInput,
            command: studioToolCommand(request.params.name, transportInput),
          }
        } catch (error) {
          valid = false
          argumentError = error.message
        }
      }
      if (args.includes('--scenario')) {
        const scenario = JSON.parse(readFileSync(option('--scenario'), 'utf8'))
        if (scenario.id !== activeScenario) {
          activeScenario = scenario.id
          fixtureState = {}
        }
        let result = instructionFixture(scenario, request.params.name, input, valid, fixtureState)
        if (argumentError) result = { isError: true, error: argumentError }
        if (
          valid &&
          request.params.name === 'secure_input' &&
          !result.isError &&
          !args.includes('--legacy-state-results')
        ) {
          result = secureInputToolResult(result)
        }
        appendFileSync(
          records,
          JSON.stringify({
            tool: request.params.name,
            input,
            transportInput,
            valid,
            fixtureError: result.isError === true,
          }) + '\n',
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: !valid || result.isError === true,
        }
      }
      appendFileSync(
        records,
        JSON.stringify({ tool: request.params.name, input, transportInput, valid }) + '\n',
      )
      return {
        content: [
          {
            type: 'text',
            text: 'Benchmark recorded. This task is complete. Do not call another tool.',
          },
        ],
        isError: !valid,
      }
    })
    await server.connect(new StdioServerTransport())
    return
  }
  if (args.includes('--capture')) {
    const capture = captureOptions(args)
    const { taskToolsServer } = await import('../packages/runtime/dist/agent-tools/config.js')
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')
    const config = taskToolsServer(
      'selection-benchmark',
      1,
      'synthetic-not-a-credential',
      '127.0.0.1',
      false,
      true,
      'run',
      true,
      true,
      capture.memoryScopes,
      true,
      undefined,
      undefined,
      { threads: true, automations: true, browsers: true, ui: true, diagnostics: true },
      true,
      true,
    )
    const client = new Client({ name: 'selection-benchmark', version: '1' })
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.envValues,
      stderr: 'ignore',
    })
    try {
      await client.connect(transport)
      const listed = await client.listTools()
      const tools = capture.select(listed.tools)
      writeFileSync(option('--capture'), JSON.stringify(tools, null, 2) + '\n')
      console.log(
        JSON.stringify({
          tools: tools.length,
          characters: JSON.stringify(tools).length,
          descriptionCharacters: tools.reduce((n, t) => n + (t.description?.length ?? 0), 0),
        }),
      )
    } finally {
      await client.close()
      await transport.close()
    }
    return
  }
  if (!args.includes('--run')) {
    console.log(
      'Build runtime, then use --capture <catalog.json>, or --run --catalog <catalog.json> --output <report.json> --model <provider/model> --executable <opencode path>. Live mode uses mock MCP tools only. Optional --cases <comma-separated IDs>.',
    )
    return
  }
  const catalog = resolve(option('--catalog'))
  const selectedCases = instructionSuite
    ? args.includes('--case-definitions')
      ? JSON.parse(readFileSync(option('--case-definitions'), 'utf8'))
      : instructionCases
    : cases
  if (
    !Array.isArray(selectedCases) ||
    new Set(selectedCases.map((test) => test.id)).size !== selectedCases.length
  )
    throw new Error('Case definitions must be an array with unique IDs')
  const instructionProfiles = instructionSuite
    ? JSON.parse(readFileSync(option('--instructions'), 'utf8'))
    : undefined
  const reportPath = resolve(option('--output'))
  const model = option('--model')
  const executable = option('--executable')
  const requested = args.includes('--cases')
    ? option('--cases').split(',')
    : selectedCases.map((test) => test.id)
  for (const id of requested)
    if (!selectedCases.some((test) => test.id === id)) throw new Error('Unknown case: ' + id)
  const { OpenCodeServers, opencodeHeaders } =
    await import('../packages/runtime/dist/agents/providers/opencode/opencode-server.js')
  const { OpenCode } =
    await import('../packages/runtime/node_modules/@opencode/client/dist/promise/index.js')
  const servers = new OpenCodeServers()
  const directory = mkdtempSync(join(tmpdir(), 'dovo-tool-selection-'))
  const records = join(directory, 'calls.jsonl')
  const scenarioPath = join(directory, 'scenario.json')
  const reports = []
  let usage = 0
  let usageReports = 0
  const started = Date.now()
  let lease
  const catalogHash = createHash('sha256').update(readFileSync(catalog)).digest('hex')
  const source = Object.fromEntries(
    [
      new URL(import.meta.url),
      new URL('./model-instruction-cases.mjs', import.meta.url),
      new URL('../packages/runtime/dist/agent-tools/response-prepare-command.js', import.meta.url),
      new URL('../packages/runtime/dist/studio/tool-definitions.js', import.meta.url),
      new URL('../packages/runtime/dist/agent-tools/workflow-command.js', import.meta.url),
      new URL('../packages/runtime/dist/agent-tools/terminal-input-command.js', import.meta.url),
    ].map((url) => [basename(url.pathname), readFileSync(url, 'utf8')]),
  )
  mkdirSync(dirname(reportPath), { recursive: true })
  const save = () =>
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          model,
          workingDirectory: directory,
          providerRequestGate: args.includes('--provider-base-url')
            ? 'shared loopback proxy'
            : null,
          ...(instructionSuite
            ? {
                suite: 'instructions',
                caseHash: createHash('sha256').update(JSON.stringify(selectedCases)).digest('hex'),
                instructionHash: createHash('sha256')
                  .update(JSON.stringify(instructionProfiles))
                  .digest('hex'),
                stateGuidance: !args.includes('--legacy-state-results'),
              }
            : {}),
          catalog: basename(catalog),
          catalogHash,
          source,
          requested,
          cases: reports.length,
          complete: reports.length === requested.length,
          correct: reports.filter((r) => r.correct).length,
          ...(instructionSuite
            ? { totalCalls: reports.reduce((sum, report) => sum + report.calls.length, 0) }
            : {
                selected: reports.filter((r) => r.selected).length,
                singleAction: reports.filter((r) => r.singleAction).length,
              }),
          valid: reports.filter((r) => r.valid).length,
          reportedTokens: usageReports ? usage : null,
          usageReports,
          durationMs: Date.now() - started,
          results: reports,
        },
        null,
        2,
      ) + '\n',
    )
  try {
    lease = await servers.acquire(
      {
        id: 'benchmark',
        name: 'Benchmark',
        provider: 'opencode',
        model,
        endpoint: '',
        instructions: '',
        permission: 'read-only',
        executablePath: executable,
        ...(args.includes('--provider-base-url')
          ? { env: providerGateEnvironment(model, option('--provider-base-url'), process.env) }
          : {}),
      },
      undefined,
      directory,
    )
    const api = OpenCode.make({
      baseUrl: lease.agent.endpoint,
      headers: opencodeHeaders(lease.agent.env),
    })
    await api.mcp.add({
      server: 'selection_bench',
      location: { directory },
      config: {
        type: 'local',
        command: [
          process.execPath,
          fileURLToPath(import.meta.url),
          '--mock',
          catalog,
          '--records',
          records,
          ...(instructionSuite ? ['--scenario', scenarioPath] : []),
          ...(args.includes('--legacy-state-results') ? ['--legacy-state-results'] : []),
        ],
      },
    })
    const deadline = AbortSignal.timeout(20 * 60 * 1000)
    for (const test of selectedCases.filter((test) => requested.includes(test.id))) {
      deadline.throwIfAborted()
      if (usage >= 500000) throw new Error('Reported usage cap reached')
      const tick = Date.now()
      const controller = new AbortController()
      const signal = AbortSignal.any([deadline, controller.signal, AbortSignal.timeout(120000)])
      let session
      let error
      let cleanupFailure
      let assistantText = ''
      let toolAttempts = []
      let inspectionError
      const nativeAttempts = []
      writeFileSync(records, '')
      if (instructionSuite) writeFileSync(scenarioPath, JSON.stringify(test))
      try {
        session = await api.session.create(
          {
            title: 'Tool selection benchmark ' + test.id,
            model: {
              providerID: model.split('/')[0],
              id: model.slice(model.indexOf('/') + 1),
              variant: 'low',
            },
            location: { directory },
            permissions: [
              { action: '*', resource: '*', effect: 'deny' },
              { action: 'selection_bench_*', resource: '*', effect: 'allow' },
            ],
          },
          { signal },
        )
        await api.session.instructions.entry.put(
          {
            sessionID: session.id,
            key: 'benchmark',
            value: instructionSuite
              ? [
                  instructionProfiles[test.profile ?? 'default'],
                  'Evaluation environment: all MCP actions use fixtures. Follow the user request and tool results. Native tools are denied. Report only what tool results establish. Do not retry failed fixture actions. No real action runs.',
                  test.context ?? '',
                ].join('\n\n')
              : 'This is a tool-selection benchmark. Use a provided tool when it fits the user task. If none fits, answer normally. Do not use native shell or file tools. Stop immediately after the first tool response. Never perform a second action.',
          },
          { signal },
        )
        let connected
        const ready = new Promise((resolve) => (connected = resolve))
        const events = (async () => {
          for await (const event of api.event.subscribe({ signal })) {
            if (event.type === 'server.connected') connected()
            if (!('data' in event) || event.data?.sessionID !== session.id) continue
            if (event.type === 'session.text.ended')
              assistantText = (assistantText + event.data.text).slice(-4000)
            if (
              event.type === 'session.tool.input.started' &&
              !event.data.name.startsWith('selection_bench_')
            )
              nativeAttempts.push(event.data.name)
            if (event.type === 'session.execution.failed') throw new Error(event.data.error.message)
            if (event.type === 'session.execution.succeeded') return
          }
          throw new Error('Event stream closed before completion')
        })()
        void events.catch(() => undefined)
        await Promise.race([ready, events])
        await api.session.prompt({ sessionID: session.id, text: test.prompt }, { signal })
        await events
        const snapshot = await api.session.get({ sessionID: session.id }, { signal })
        if (
          snapshot.tokens &&
          Object.values(snapshot.tokens).some((value) => typeof value === 'number' && value > 0)
        ) {
          usage +=
            (snapshot.tokens.input ?? 0) +
            (snapshot.tokens.output ?? 0) +
            (snapshot.tokens.cache?.read ?? 0) +
            (snapshot.tokens.cache?.write ?? 0)
          usageReports++
        }
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      } finally {
        controller.abort()
        if (session) {
          try {
            const messages = await api.message.list(
              { sessionID: session.id, limit: 20, order: 'asc' },
              { signal: AbortSignal.timeout(5000) },
            )
            toolAttempts = messages.data.flatMap((message) => {
              const parts = Array.isArray(message.content)
                ? message.content
                : Array.isArray(message.parts)
                  ? message.parts
                  : []
              return parts
                .filter((part) => part.type === 'tool')
                .map((part) => ({
                  name: part.name ?? part.tool,
                  status: part.state?.status,
                  input: part.state?.input,
                  error: part.state?.error,
                }))
            })
          } catch (cause) {
            inspectionError = cause instanceof Error ? cause.message : String(cause)
          }
          // Confirm termination before reusing the shared mock log for another case.
          try {
            await api.session.interrupt(
              { sessionID: session.id },
              { signal: AbortSignal.timeout(10000) },
            )
            await api.session.wait(
              { sessionID: session.id },
              { signal: AbortSignal.timeout(10000) },
            )
            await api.session.remove(
              { sessionID: session.id },
              { signal: AbortSignal.timeout(10000) },
            )
          } catch (cause) {
            error =
              'Session cleanup failed: ' + (cause instanceof Error ? cause.message : String(cause))
            cleanupFailure = cause
          }
        }
      }
      const calls = readFileSync(records, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
      reports.push({
        ...(instructionSuite
          ? scoreInstructions(test, calls, error, assistantText, nativeAttempts, toolAttempts)
          : score(test, calls, error)),
        transportInput: calls[0]?.transportInput,
        assistantText,
        toolAttempts,
        ...(inspectionError ? { inspectionError } : {}),
        nativeAttempts,
        durationMs: Date.now() - tick,
      })
      console.log(JSON.stringify(reports.at(-1)))
      save()
      if (cleanupFailure) throw cleanupFailure
    }
  } finally {
    save()
    lease?.release()
    await servers.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
