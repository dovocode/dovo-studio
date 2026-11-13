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
      expect(tools).toHaveLength(full ? 47 : 20)
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
      const automationTools = ['automation_list', 'automation_prepare'].map((name) => {
        const tool = tools.find((item) => item.name === name)
        expect(tool).toBeDefined()
        expect(JSON.stringify(tool).length + 1).toBeLessThanOrEqual(1600)
        expect(tool?.description?.length ?? 0).toBeLessThanOrEqual(500)
        return tool
      })
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
          secureCharacters -
          prepareCharacters -
          automationCharacters -
          workflowCharacters,
      ).toBeLessThanOrEqual(full ? 48500 : 10000)
      expect(
        descriptionCharacters -
          (secureInput?.description?.length ?? 0) -
          (threadPrepare?.description?.length ?? 0) -
          (workflow?.description?.length ?? 0) -
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
