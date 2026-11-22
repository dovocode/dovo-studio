import { expect, it } from 'vite-plus/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { taskToolsServer } from './config.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js'

// Measure the real advertised schemas, including generated unions and Studio tools.
// Character counts are deterministic budgets, not tokenizer-specific token counts.
it.each([false, true])(
  'keeps the advertised tool context within budget (all features: %s)',
  async (full) => {
    const config = taskToolsServer(
      'measurement',
      1,
      'not-a-live-credential',
      '127.0.0.1',
      false,
      full,
      'run',
      full,
      full,
      full ? ['system'] : [],
      full,
      undefined,
      undefined,
      { threads: full, automations: full, browsers: full, ui: full, diagnostics: full },
      true,
      full,
    )
    const client = new Client({ name: 'tool-context-budget', version: '1' })
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.envValues,
      stderr: 'ignore',
    })
    try {
      await client.connect(transport)
      const { tools } = await client.listTools()
      // Shared guidance omits repeated details. Keep their authoritative tool
      // descriptions visible in both the base and full catalogs.
      for (const [name, phrases] of [
        ['workflow', ['No scripts/schedules or delegation permission', 'Read child results']],
        ['subagent_cancel', ['Offline cancellation remains pending until confirmed']],
        ['subagent_list', ['Use subagent_read/wait for answers']],
        ...(full
          ? [
              ['pull_request_watch', ['use notifications, never poll']],
              ['pipeline_watch', ['Discover IDs once; register replacements']],
            ]
          : []),
      ] as const) {
        const description = tools.find((tool) => tool.name === name)?.description
        for (const phrase of phrases) expect(description).toContain(phrase)
      }
      // Exercise the schemas from the real stdio catalog. Strict Effect commands
      // must expose fields, not Unknown, so agents can construct valid calls.
      const vision = tools.find((tool) => tool.name === 'vision')
      expect(vision).toBeDefined()
      const visionCharacters = JSON.stringify(vision).length + 1
      expect(visionCharacters).toBeLessThanOrEqual(6000)
      const code = tools.find((tool) => tool.name === 'code')
      expect(code).toBeDefined()
      const codeCharacters = JSON.stringify(code).length + 1
      expect(codeCharacters).toBeLessThanOrEqual(1200)
      const schemas = new AjvJsonSchemaValidator()
      const strictCalls: Record<string, object> = {
        thread_prepare: { key: 'review', title: 'Review', prompt: 'Review the API' },
        response_prepare: {
          key: 'reply',
          title: 'Continue',
          action: { kind: 'prompt', prompt: 'Continue' },
        },
        automation_list: { limit: 50 },
        dashboards: { action: 'list' },
        automation_prepare: {
          key: 'routine',
          title: 'Review run',
          automationId: 'routine-42',
          prompt: 'Check status',
        },
        workflow: {
          action: 'create',
          id: 'plan',
          name: 'Plan',
          phases: [{ id: 'one', title: 'Read' }],
        },
      }
      for (const [name, input] of Object.entries(strictCalls)) {
        const tool = tools.find((tool) => tool.name === name)
        expect(tool).toBeDefined()
        if (!tool) throw new Error(`Missing tool: ${name}`)
        const validator = schemas.getValidator(tool.inputSchema)
        expect({ name, valid: validator(input).valid }).toEqual({ name, valid: true })
        expect({ name, valid: validator({ ...input, unknownField: true }).valid }).toEqual({
          name,
          valid: false,
        })
        expect({ name, valid: validator({}).valid }).toEqual({
          name,
          valid: name === 'automation_list',
        })
      }
      expect(
        tools
          .filter((tool) => tool.inputSchema.anyOf)
          .every((tool) => Object.keys(tool.inputSchema.properties ?? {}).length > 0),
      ).toBe(true)
      const checklist = tools.find((tool) => tool.name === 'todos')
      if (!checklist) throw new Error('Missing todos')
      expect(checklist.inputSchema.properties?.action).toEqual({
        type: 'string',
        enum: ['list', 'set'],
      })
      expect(checklist.inputSchema.properties?.items).toBeDefined()
      const checklistInput = schemas.getValidator(checklist.inputSchema)
      for (const input of [{ action: 'list' }, { action: 'set', items: [] }])
        expect(checklistInput(input).valid).toBe(true)
      for (const input of [
        {},
        { action: 'set' },
        { action: 'list', items: [] },
        { action: 'set', items: [{ text: 'Bad', status: 'done' }] },
      ])
        expect(checklistInput(input).valid).toBe(false)
      const child = tools.find((tool) => tool.name === 'subagent_spawn')
      if (!child) throw new Error('Missing subagent_spawn')
      const childInput = schemas.getValidator(child.inputSchema)
      const base = { key: 'review', name: 'Review', prompt: 'Review input validation' }
      expect(child.inputSchema.properties?.provider).toMatchObject({
        description: expect.stringContaining('For OpenCode use'),
      })
      // The root enum defines providers. The local branch excludes generic ACP,
      // which needs a configured agent or an explicit project/computer target.
      for (const provider of [
        'codex',
        'claude',
        'vibe',
        'opencode',
        'hermes',
        'copilot',
        'grok',
        'muse',
        'cursor',
      ])
        expect(childInput({ ...base, provider }).valid).toBe(true)
      for (const target of [
        { agentId: 'agent' },
        { repositoryId: 'repo' },
        { runtimeId: 'runtime' },
      ]) {
        expect(childInput({ ...base, ...target }).valid).toBe(true)
        expect(childInput({ ...base, ...target, provider: 'acp' }).valid).toBe(true)
        expect(childInput({ ...base, ...target, provider: 'unknown' }).valid).toBe(false)
      }
      for (const input of [
        {},
        { checkoutId: 'linked' },
        { provider: 'acp' },
        { provider: 'unknown' },
      ])
        expect(childInput({ ...base, ...input }).valid).toBe(false)
      const responseSchema = tools.find((tool) => tool.name === 'response_prepare')
      if (!responseSchema) throw new Error('Missing response_prepare')
      expect(
        schemas.getValidator(responseSchema.inputSchema)({
          key: 'reply',
          title: 'Continue',
          action: { kind: 'prompt' },
        }).valid,
      ).toBe(false)
      const a2ui = tools.find((tool) => tool.name === 'a2ui')
      expect(a2ui).toBeDefined()
      const a2uiCharacters = JSON.stringify(a2ui).length + 1
      expect(a2uiCharacters).toBeLessThanOrEqual(2000)
      expect(a2ui?.description?.length ?? 0).toBeLessThanOrEqual(500)
      // Dashboard authoring has its own budget, so it cannot hide growth in other tools.
      const dashboards = tools.find((tool) => tool.name === 'dashboards')
      if (!dashboards) throw new Error('Missing dashboards')
      const dashboardCharacters = JSON.stringify(dashboards).length + 1
      const dashboardDescriptionCharacters = dashboards.description?.length ?? 0
      expect(dashboardCharacters).toBeLessThanOrEqual(1900)
      expect(dashboardDescriptionCharacters).toBeLessThanOrEqual(300)
      expect(dashboards.inputSchema.properties?.action).toEqual({
        type: 'string',
        enum: ['list', 'read', 'create', 'update', 'delete'],
      })
      const dashboardInput = schemas.getValidator(dashboards.inputSchema)
      const tile = { title: 'Tests', kind: 'command', span: 2, height: 1, command: 'pnpm test' }
      for (const input of [
        { action: 'read', id: 'dashboard' },
        { action: 'create', dashboard: { title: 'Ops', tiles: [tile] } },
        { action: 'update', id: 'd', expectedRevision: 1, dashboard: { title: 'Ops', tiles: [] } },
        { action: 'delete', id: 'd', expectedRevision: 1 },
      ])
        expect(dashboardInput(input).valid).toBe(true)
      for (const input of [
        { action: 'run', id: 'd' },
        { action: 'create', dashboard: { title: 'Ops', tiles: [{ ...tile, kind: 'shell' }] } },
        { action: 'create', dashboard: { title: 'Ops', tiles: [{ ...tile, headers: {} }] } },
        { action: 'update', id: 'd', expectedRevision: 0, dashboard: { title: 'Ops', tiles: [] } },
      ])
        expect(dashboardInput(input).valid).toBe(false)
      const characters = JSON.stringify(tools).length
      const descriptionCharacters = tools.reduce(
        (total, tool) => total + (tool.description?.length ?? 0),
        0,
      )
      const extensions = tools.find((tool) => tool.name === 'studio_extensions')
      expect(extensions).toBeDefined()
      const extensionCharacters = JSON.stringify(extensions).length + 1
      const extensionDescription = extensions?.description?.length ?? 0
      expect(extensionCharacters).toBeLessThanOrEqual(950)
      expect(extensionDescription).toBeLessThanOrEqual(300)
      expect(tools).toHaveLength(full ? 57 : 29)
      const pipelineCi = tools.find((tool) => tool.name === 'pipeline_ci')
      expect(!!pipelineCi).toBe(full)
      const pipelineCiCharacters = pipelineCi ? JSON.stringify(pipelineCi).length + 1 : 0
      const pipelineCiDescriptionCharacters = pipelineCi?.description?.length ?? 0
      expect(pipelineCiCharacters).toBeLessThanOrEqual(850)
      expect(pipelineCiDescriptionCharacters).toBeLessThanOrEqual(250)
      // The studio_automations dry run text has its own budget below.
      const dryRunText = ' dryRun tests automation with sample input; changes nothing.'
      const studioAutomations = tools.find((tool) => tool.name === 'studio_automations')
      expect(studioAutomations?.description?.includes(dryRunText) ?? false).toBe(full)
      expect(
        descriptionCharacters -
          (a2ui?.description?.length ?? 0) -
          (code?.description?.length ?? 0) -
          (vision?.description?.length ?? 0) -
          (full ? dryRunText.length : 0) -
          pipelineCiDescriptionCharacters -
          dashboardDescriptionCharacters -
          extensionDescription,
      ).toBeLessThanOrEqual(full ? 11000 : 6000)
      const terminalRename = tools.find((tool) => tool.name === 'terminal_rename')
      expect(terminalRename).toBeDefined()
      const renameCharacters = JSON.stringify(terminalRename).length + 1
      expect(renameCharacters).toBeLessThanOrEqual(650)
      expect(terminalRename?.description?.length ?? 0).toBeLessThanOrEqual(160)
      const conversation = tools.find((tool) => tool.name === 'conversation_read')
      expect(conversation).toBeDefined()
      const conversationCharacters = JSON.stringify(conversation).length + 1
      expect(conversationCharacters).toBeLessThanOrEqual(1200)
      expect(conversation?.description?.length ?? 0).toBeLessThanOrEqual(300)
      // Theme commands extend the existing UI union. Bound that addition separately.
      const ui = tools.find((tool) => tool.name === 'studio_ui')
      const withoutThemes =
        ui &&
        JSON.stringify(ui, (_key, value: unknown) => {
          if (!Array.isArray(value)) return value
          return value.filter((entry: unknown) => {
            if (!entry || typeof entry !== 'object' || !('properties' in entry)) return true
            const properties = entry.properties
            if (!properties || typeof properties !== 'object' || !('action' in properties))
              return true
            const action = properties.action
            return (
              !action ||
              typeof action !== 'object' ||
              !('enum' in action) ||
              !Array.isArray(action.enum) ||
              !action.enum.some((value) => value === 'theme-read' || value === 'theme-set')
            )
          })
        })
      const themeCharacters = ui ? JSON.stringify(ui).length - (withoutThemes?.length ?? 0) : 0
      expect(themeCharacters > 0).toBe(full)
      expect(themeCharacters).toBeLessThanOrEqual(1000)
      // Preserve the existing budget for all prior tools. Account for the new private-input
      // schema separately so adding this tool cannot hide growth in unrelated tools.
      const secureInput = tools.find((tool) => tool.name === 'secure_input')
      expect(secureInput).toBeDefined()
      if (!secureInput) throw new Error('Missing secure_input')
      expect(secureInput.inputSchema.properties?.action).toEqual({
        type: 'string',
        enum: ['request', 'status', 'cancel'],
      })
      expect(secureInput.inputSchema.properties?.id).toEqual({ type: 'string' })
      const privateArguments = schemas.getValidator(secureInput.inputSchema)
      const request = {
        action: 'request',
        key: 'sign-in',
        title: 'Sign in',
        prompt: 'Enter privately',
        destination: { kind: 'auth_callback', installationId: 'install-42' },
      }
      for (const input of [
        request,
        { ...request, destination: JSON.stringify(request.destination) },
        { action: 'status', id: 'request-42' },
        { action: 'cancel', id: 'request-42' },
      ]) {
        expect(privateArguments(input).valid).toBe(true)
      }
      for (const input of [
        {},
        { action: 'status' },
        { action: 'cancel' },
        { action: 'request', key: 'sign-in' },
        { action: 'unknown', id: 'request-42' },
        { ...request, destination: { kind: 'unknown' } },
      ]) {
        expect(privateArguments(input).valid).toBe(false)
      }
      const secureCharacters = JSON.stringify(secureInput).length + 1
      expect(secureCharacters).toBeLessThanOrEqual(3000)
      // The new-thread action card is accounted for separately, like secure_input.
      const threadPrepare = tools.find((tool) => tool.name === 'thread_prepare')
      expect(threadPrepare).toBeDefined()
      const prepareCharacters = JSON.stringify(threadPrepare).length + 1
      expect(prepareCharacters).toBeLessThanOrEqual(1600)
      // Workflow discovery and review have their own budgets; prior tools keep theirs.
      const automationTools = ['automation_list', 'automation_prepare', 'response_prepare'].map(
        (name) => {
          const tool = tools.find((item) => item.name === name)
          expect(tool).toBeDefined()
          expect(JSON.stringify(tool).length + 1).toBeLessThanOrEqual(
            name === 'response_prepare' ? 3000 : 1600,
          )
          expect(tool?.description?.length ?? 0).toBeLessThanOrEqual(500)
          return tool
        },
      )
      const help = tools.find((tool) => tool.name === 'dovo_help')
      expect(help).toBeDefined()
      const helpCharacters = JSON.stringify(help).length + 1
      expect(helpCharacters).toBeLessThanOrEqual(1600)
      const workflow = tools.find((tool) => tool.name === 'workflow')
      expect(workflow).toBeDefined()
      expect(workflow?.inputSchema.properties?.action).toEqual({
        type: 'string',
        enum: ['list', 'read', 'create', 'attach'],
      })
      if (!workflow) throw new Error('Missing workflow')
      const planInput = schemas.getValidator(workflow.inputSchema)
      expect(
        planInput({
          ...strictCalls.workflow,
          phases: JSON.stringify([{ id: 'one', title: 'Read' }]),
        }).valid,
      ).toBe(true)
      expect(planInput({ action: 'list', phases: [] }).valid).toBe(false)
      const workflowCharacters = JSON.stringify(workflow).length + 1
      expect(workflowCharacters).toBeLessThanOrEqual(3000)
      // The routine source input has its own budget, so it cannot hide growth in other tools.
      const withoutRoutineSource = (value: unknown): unknown =>
        Array.isArray(value)
          ? value.map(withoutRoutineSource)
          : value && typeof value === 'object'
            ? Object.fromEntries(
                Object.entries(value)
                  .filter(
                    ([key, child]) =>
                      key !== 'RoutineSource' &&
                      !(key === 'source' && JSON.stringify(child).includes('RoutineSource')),
                  )
                  .map(([key, child]) => [key, withoutRoutineSource(child)]),
              )
            : value
      const routineSourceCharacters = studioAutomations
        ? JSON.stringify(studioAutomations).length -
          JSON.stringify(withoutRoutineSource(studioAutomations)).length
        : 0
      expect(routineSourceCharacters > 0).toBe(full)
      expect(routineSourceCharacters).toBeLessThanOrEqual(400)
      // Dry runs have their own budget too: the action, its sample input and its description.
      const withoutDryRun = (value: unknown): unknown => {
        if (Array.isArray(value))
          return value.filter((entry) => entry !== 'dryRun').map(withoutDryRun)
        if (!value || typeof value !== 'object') return value
        const entries = Object.entries(value)
        const dryRunBranch = entries.some(
          ([key, child]) => key === 'action' && JSON.stringify(child).includes('"dryRun"'),
        )
        return Object.fromEntries(
          entries
            .filter(([key]) => !(dryRunBranch && (key === 'input' || key === 'stopAt')))
            .map(([key, child]) => [
              key,
              key === 'description' && typeof child === 'string'
                ? child.replace(dryRunText, '')
                : withoutDryRun(child),
            ]),
        )
      }
      const dryRunCharacters = studioAutomations
        ? JSON.stringify(studioAutomations).length -
          JSON.stringify(withoutDryRun(studioAutomations)).length
        : 0
      expect(dryRunCharacters > 0).toBe(full)
      expect(dryRunCharacters).toBeLessThanOrEqual(700)
      const automationCharacters = automationTools.reduce(
        (total, tool) => total + JSON.stringify(tool).length + 1,
        0,
      )
      expect(
        characters -
          visionCharacters -
          codeCharacters -
          a2uiCharacters -
          renameCharacters -
          secureCharacters -
          prepareCharacters -
          automationCharacters -
          routineSourceCharacters -
          dryRunCharacters -
          workflowCharacters -
          helpCharacters -
          conversationCharacters -
          themeCharacters -
          pipelineCiCharacters -
          dashboardCharacters -
          extensionCharacters,
      ).toBeLessThanOrEqual(full ? 48500 : 10000)
      expect(
        descriptionCharacters -
          (vision?.description?.length ?? 0) -
          (code?.description?.length ?? 0) -
          (a2ui?.description?.length ?? 0) -
          (terminalRename?.description?.length ?? 0) -
          (secureInput?.description?.length ?? 0) -
          (threadPrepare?.description?.length ?? 0) -
          (workflow?.description?.length ?? 0) -
          (help?.description?.length ?? 0) -
          (conversation?.description?.length ?? 0) -
          pipelineCiDescriptionCharacters -
          dashboardDescriptionCharacters -
          extensionDescription -
          automationTools.reduce((total, tool) => total + (tool?.description?.length ?? 0), 0),
      ).toBeLessThanOrEqual(full ? 12900 : 3200)
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'ask_question',
          'secure_input',
          'todos',
          'browser',
          'subagent_spawn',
          'subagent_answer',
          'terminal_run',
          'terminal_rename',
          'dashboards',
          'studio_extensions',
        ]),
      )
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(
          full
            ? [
                'skill_read',
                'memory_read',
                'artifact_create',
                'studio_threads',
                'studio_automations',
                'devices',
              ]
            : [],
        ),
      )
      console.log(
        JSON.stringify({
          profile: full ? 'all features and skill reads' : 'core',
          tools: tools.length,
          characters,
          descriptionCharacters,
        }),
      )
    } finally {
      await client.close()
      await transport.close()
    }
  },
)
