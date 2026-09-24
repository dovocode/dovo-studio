import { claudeCommand } from '../claude-command.js'
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentDiscovery, ModelCatalog } from '@dovo/protocol'
import { processEnvironment } from '../../process.js'
export async function claudeModels(agent: AgentDiscovery): Promise<ModelCatalog> {
  const command = await claudeCommand(agent.endpoint)
  const controller = new AbortController()
  const input: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        // Keep the control channel open without submitting a model prompt.
        if (!controller.signal.aborted)
          await new Promise<void>((resolve) =>
            controller.signal.addEventListener('abort', () => resolve(), { once: true }),
          )
        return { done: true, value: undefined }
      },
    }),
  }
  const stream = query({
    prompt: input,
    options: {
      env: processEnvironment(),
      abortController: controller,
      settingSources: [],
      pathToClaudeCodeExecutable: command,
    },
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const models = await Promise.race([
      stream.supportedModels(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Claude model discovery timed out')), 20000)
      }),
    ])
    return {
      models: models.map((model) => ({
        id: model.value,
        name: model.displayName,
        description: model.description,
        reasoning: (model.supportedEffortLevels ?? []).map((id) => ({ id, name: id })),
      })),
      reasoning: (
        models.find((model) => model.value === 'default')?.supportedEffortLevels ?? []
      ).map((id) => ({ id, name: id })),
    }
  } finally {
    clearTimeout(timer)
    controller.abort()
    stream.close()
  }
}
