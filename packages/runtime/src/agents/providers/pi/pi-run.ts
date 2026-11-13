import { processEnvironment } from '../../../process.js'
import type { AgentRun } from '../../execution/types.js'
import { nativeObject as object, nativeText as text } from '../shared/native.js'
import { PiRpc } from './rpc.js'
import { requirePiVersion } from './pi-version.js'
import { piBuiltinToolsAllowed } from '@dovo/protocol'

/** Pi tools are available only with explicit, unrestricted full access. */
export async function runPiSession(run: AgentRun) {
  run.signal.throwIfAborted()
  if (!run.sessionId) throw new Error('Pi continuation requires an imported session')
  if (run.attachments?.length) throw new Error('Pi continuation does not support attachments yet')
  if (run.agent.args?.length)
    throw new Error('Pi custom launch arguments are unavailable for safe continuation')
  if (run.agent.resources?.mcpServers?.some((server) => server.enabled))
    throw new Error('Pi continuation does not support MCP servers')
  await requirePiVersion(run.agent)
  const toolsAllowed = piBuiltinToolsAllowed(run.agent, {
    textOnly: run.tools === 'none',
    readOnlyCheckout: run.linkedDirectories?.some((link) => link.access === 'read-only'),
  })
  const args = [
    ...(toolsAllowed ? ['--tools', 'read,bash,edit,write'] : ['--no-tools']),
    '--no-extensions',
    '--no-mcp',
    '--no-skills',
    '--no-prompt-templates',
  ]
  if (run.agent.model) args.push('--model', run.agent.model)
  const rpc = new PiRpc(
    run.agent.endpoint || 'pi',
    args,
    run.cwd,
    processEnvironment(run.agent.env),
  )
  run.onOwnedProcess?.(rpc.child)
  let removeEvent = () => {},
    removeFailure = () => {},
    abort = () => {},
    timer: ReturnType<typeof setTimeout> | undefined
  try {
    const switched = await rpc.request(
      { type: 'switch_session', sessionPath: run.sessionId },
      run.signal,
    )
    if (object(switched.data).cancelled === true)
      throw new Error('Pi cancelled session continuation')
    const state = object((await rpc.request({ type: 'get_state' }, run.signal)).data)
    if (text(state.sessionFile) !== run.sessionId)
      throw new Error('Pi did not open the requested session file')
    if (run.agent.model) {
      const available = object(
        (await rpc.request({ type: 'get_available_models' }, run.signal)).data,
      )
      const models = Array.isArray(available.models) ? available.models.map(object) : []
      const exact = models.filter(
        (model) => `${text(model.provider)}/${text(model.id)}` === run.agent.model,
      )
      const matches = exact.length
        ? exact
        : models.filter((model) => text(model.id) === run.agent.model)
      if (matches.length !== 1)
        throw new Error(
          matches.length
            ? 'Pi model is ambiguous. Select provider/model.'
            : `Pi model not found: ${run.agent.model}`,
        )
      const model = matches[0]!
      await rpc.request(
        { type: 'set_model', provider: text(model.provider), modelId: text(model.id) },
        run.signal,
      )
    }
    if (run.agent.reasoning) {
      const available = object(
        (await rpc.request({ type: 'get_available_thinking_levels' }, run.signal)).data,
      )
      if (!Array.isArray(available.levels) || !available.levels.includes(run.agent.reasoning))
        throw new Error(`Pi thinking level is not available for this model: ${run.agent.reasoning}`)
      await rpc.request({ type: 'set_thinking_level', level: run.agent.reasoning }, run.signal)
    }
    if (run.agent.model || run.agent.reasoning) {
      const selected = object((await rpc.request({ type: 'get_state' }, run.signal)).data)
      const model = object(selected.model)
      if (
        run.agent.model &&
        ![text(model.id), `${text(model.provider)}/${text(model.id)}`].includes(run.agent.model)
      )
        throw new Error('Pi did not apply the requested model')
      if (run.agent.reasoning && selected.thinkingLevel !== run.agent.reasoning)
        throw new Error('Pi did not apply the requested thinking level')
    }
    run.onSession(run.sessionId)
    let resolveTurn: () => void = () => {},
      rejectTurn: (error: Error) => void = () => {}
    const completed = new Promise<void>((resolve, reject) => {
      resolveTurn = resolve
      rejectTurn = reject
    })
    void completed.catch(() => {})
    let assistantError: string | undefined
    removeEvent = rpc.onEvent((event) => {
      if (event.type === 'tool_execution_start') {
        run.onActivity(text(event.toolName) || 'Pi tool')
        run.onEvent?.('pi/tool', event)
      }
      if (event.type === 'message_update') {
        const update = object(event.assistantMessageEvent)
        if (update.type === 'text_delta') run.onText(text(update.delta))
      }
      if (event.type === 'message_end') {
        const message = object(event.message)
        if (message.role === 'assistant')
          assistantError =
            message.stopReason === 'error' || message.stopReason === 'aborted'
              ? text(message.errorMessage) || 'Pi turn failed'
              : undefined
      }
      if (event.type === 'agent_settled') {
        if (event.aborted === true) rejectTurn(new Error('Pi turn was aborted'))
        else if (assistantError) rejectTurn(new Error(assistantError))
        else resolveTurn()
      }
    })
    removeFailure = rpc.onFailure(rejectTurn)
    abort = () => rejectTurn(new Error('Pi turn was cancelled'))
    run.signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => rejectTurn(new Error('Pi turn timed out')), 30 * 60 * 1000)
    const response = await rpc.request({ type: 'prompt', message: run.prompt }, run.signal)
    run.onPromptAccepted?.()
    if (object(response.data).disposition !== 'handled') await completed
  } finally {
    removeEvent()
    removeFailure()
    run.signal.removeEventListener('abort', abort)
    if (timer) clearTimeout(timer)
    await rpc.close()
  }
}
