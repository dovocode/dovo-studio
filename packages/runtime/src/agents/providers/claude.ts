import { decode } from '@dovo/protocol'
import { claudeMcpServers } from '../mcp-settings.js'
import { claudeInput } from './claude-input.js'
import { Schema } from 'effect'
import { claudeModels } from '../catalogs/claude.js'
import { claudeQuestions } from './claude-questions.js'
import { formQuestions } from './form-questions.js'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { AgentAdapter } from '../types.js'
import { executableAvailable, processEnvironment } from '../../process.js'
export const claudeAdapter: AgentAdapter = {
  models: claudeModels,
  probe: async (agent) => ({
    provider: 'claude',
    available: !agent.endpoint || (await executableAvailable(agent.endpoint)),
    detail: 'Claude Agent SDK installed. Uses the host’s Claude login or ANTHROPIC_API_KEY.',
  }),
  async run(run) {
    const controller = new AbortController(),
      abort = () => controller.abort()
    run.signal.addEventListener('abort', abort, {
      once: true,
    })
    if (run.signal.aborted) abort()
    const stream = query({
      prompt: run.attachments?.length ? claudeInput(run) : run.prompt,
      options: {
        cwd: run.cwd,
        env: processEnvironment(),
        abortController: controller,
        ...(run.sessionId
          ? {
              resume: run.sessionId,
            }
          : {}),
        ...(run.agent.model
          ? {
              model: run.agent.model,
            }
          : {}),
        ...(run.agent.reasoning
          ? {
              effort: decode(
                Schema.Literal('low', 'medium', 'high', 'xhigh', 'max'),
                run.agent.reasoning,
              ),
            }
          : {}),
        ...(run.agent.endpoint
          ? {
              pathToClaudeCodeExecutable: run.agent.endpoint,
            }
          : {}),
        systemPrompt:
          run.tools === 'none'
            ? run.agent.instructions
            : {
                type: 'preset',
                preset: 'claude_code',
                append: run.agent.instructions,
              },
        permissionMode:
          run.agent.permission === 'full-access'
            ? 'bypassPermissions'
            : run.agent.permission === 'auto'
              ? 'auto'
              : run.agent.permission === 'workspace-write'
                ? 'acceptEdits'
                : 'default',
        ...(run.agent.permission === 'full-access'
          ? {
              allowDangerouslySkipPermissions: true,
            }
          : {}),
        ...(run.tools === 'none'
          ? {
              tools: [],
              strictMcpConfig: true,
              mcpServers: {},
            }
          : run.agent.resources?.mcpServers.length
            ? {
                mcpServers: claudeMcpServers(run.agent.resources.mcpServers),
              }
            : {}),
        settingSources: [],
        includePartialMessages: true,
        onElicitation: async (request, options) => {
          if (request.mode !== 'form' && request.mode !== undefined) {
            run.onActivity('This Claude MCP input request is not a supported form')
            return {
              action: 'cancel',
            }
          }
          const content = await formQuestions(
            request.message,
            request.requestedSchema,
            run,
            options.signal,
          )
          return content
            ? {
                action: 'accept',
                content,
              }
            : {
                action: 'decline',
              }
        },
        ...(run.tools !== 'none' && run.agent.permission === 'read-only'
          ? {
              tools: ['Read', 'Glob', 'Grep', 'AskUserQuestion'],
            }
          : {}),
        canUseTool: async (name, input, options) => {
          if (run.tools === 'none')
            return {
              behavior: 'deny',
              message: 'Tools are disabled for text cleanup',
            }
          if (name === 'AskUserQuestion') return claudeQuestions(input, run, options.signal)
          const allowed =
            run.agent.permission === 'read-only'
              ? ['Read', 'Glob', 'Grep'].includes(name)
              : await run.approve(name, JSON.stringify(input, null, 2))
          return allowed
            ? {
                behavior: 'allow',
                updatedInput: input,
              }
            : {
                behavior: 'deny',
                message: 'Permission denied in Dovo Studio',
              }
        },
      },
    })
    try {
      for await (const message of stream) {
        run.onEvent?.(message.type, message)
        if (message.session_id) run.onSession(message.session_id)
        if (
          message.type === 'stream_event' &&
          message.event.type === 'content_block_delta' &&
          message.event.delta.type === 'text_delta'
        )
          run.onText(message.event.delta.text)
        if (message.type === 'assistant')
          for (const block of message.message.content)
            if (block.type === 'tool_use') run.onActivity(block.name)
        if (message.type === 'result' && message.subtype !== 'success')
          throw new Error(message.errors.join('\n'))
        if (message.type === 'result' && message.subtype === 'success' && message.is_error)
          throw new Error(message.result)
      }
    } finally {
      run.signal.removeEventListener('abort', abort)
      stream.close()
    }
  },
}
