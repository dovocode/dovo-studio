import { expect, it } from 'vite-plus/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { taskToolsServer } from './config.js'

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
      const characters = JSON.stringify(tools).length
      const descriptionCharacters = tools.reduce(
        (total, tool) => total + (tool.description?.length ?? 0),
        0,
      )
      expect(tools).toHaveLength(full ? 51 : 24)
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
      const workflowCharacters = JSON.stringify(workflow).length + 1
      expect(workflowCharacters).toBeLessThanOrEqual(3000)
      const automationCharacters = automationTools.reduce(
        (total, tool) => total + JSON.stringify(tool).length + 1,
        0,
      )
      expect(
        characters -
          renameCharacters -
          secureCharacters -
          prepareCharacters -
          automationCharacters -
          workflowCharacters -
          helpCharacters -
          conversationCharacters -
          themeCharacters,
      ).toBeLessThanOrEqual(full ? 48500 : 10000)
      expect(
        descriptionCharacters -
          (terminalRename?.description?.length ?? 0) -
          (secureInput?.description?.length ?? 0) -
          (threadPrepare?.description?.length ?? 0) -
          (workflow?.description?.length ?? 0) -
          (help?.description?.length ?? 0) -
          (conversation?.description?.length ?? 0) -
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
