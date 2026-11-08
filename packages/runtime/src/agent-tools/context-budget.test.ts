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
      expect(tools).toHaveLength(full ? 42 : 15)
      expect(characters).toBeLessThanOrEqual(full ? 48500 : 10000)
      expect(descriptionCharacters).toBeLessThanOrEqual(full ? 12900 : 3200)
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'ask_question',
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
