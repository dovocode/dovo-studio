import { ResponseError, ErrorCodes } from 'vscode-jsonrpc/node'
import { nativeWait } from '../shared/native.js'
import { homedir } from 'node:os'
import { Schema } from 'effect'
import {
  decode,
  decodeResult,
  mutableArray,
  mutableStruct,
  questionPromptSchema,
  isImageAttachment,
} from '@dovo/protocol'
import type { AgentDiscovery, ModelCatalog } from '@dovo/protocol'
import type { AgentAdapter, AgentRun } from '../../execution/types.js'
import { releaseIdleProvider } from '../../execution/warm-processes.js'
import { openHermesConnection } from './hermes-connection.js'
import { hermesConfig } from './hermes-config.js'

const objectSchema = Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const object = (value: unknown) => decodeResult(objectSchema, value).data ?? {}
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const catalogSchema = mutableStruct({
  model: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  providers: mutableArray(
    mutableStruct({
      slug: Schema.String,
      name: Schema.String,
      models: mutableArray(Schema.String),
      unavailable_models: Schema.optional(mutableArray(Schema.String)),
      authenticated: Schema.optional(Schema.Boolean),
      is_current: Schema.optional(Schema.Boolean),
      aliases: Schema.optional(mutableArray(Schema.String)),
      capabilities: Schema.optional(
        Schema.mutable(
          Schema.Record({
            key: Schema.String,
            value: mutableStruct({ reasoning: Schema.optional(Schema.Boolean) }),
          }),
        ),
      ),
    }),
  ),
})
const reasoning = ['low', 'medium', 'high'].map((id) => ({ id, name: id }))
type Connection = ReturnType<typeof openHermesConnection>
type Catalog = typeof catalogSchema.Type
async function modelOptions(connection: Connection, signal?: AbortSignal): Promise<Catalog> {
  return decode(catalogSchema, await connection.request('model.options', {}, signal, 30000))
}
function modelValue(catalog: Catalog, selected: string) {
  for (const provider of catalog.providers) {
    const model = provider.models.find((model) => `${provider.slug}:${model}` === selected)
    if (model === undefined) continue
    // Picker slugs (including endpoint hostnames) are identities, not model-ID prefixes.
    // Hermes' model setter uses /model syntax; keep the model intact and the switch session-only.
    const route = provider.is_current && catalog.provider ? catalog.provider : provider.slug
    return `${model} --provider ${route} --session`
  }
  // Manually entered model IDs may contain colons themselves, e.g. Ollama tags or :dev.
  return `${selected} --session`
}
export async function hermesModels(agent: AgentDiscovery): Promise<ModelCatalog> {
  const connection = openHermesConnection(agent, homedir())
  try {
    await connection.ready()
    const catalog = await modelOptions(connection)
    return {
      models: catalog.providers
        .filter((provider) => provider.authenticated !== false)
        .flatMap((provider) =>
          provider.models.map((model) => ({
            id: `${provider.slug}:${model}`,
            name: model,
            description: provider.name,
            isDefault:
              (provider.is_current === true ||
                provider.slug === catalog.provider ||
                provider.aliases?.includes(catalog.provider ?? '') === true) &&
              model === catalog.model,
            hidden: provider.unavailable_models?.includes(model),
            reasoning: provider.capabilities?.[model]?.reasoning === false ? [] : reasoning,
          })),
        ),
      reasoning,
    }
  } finally {
    await connection.close()
  }
}
type WarmHermes = {
  connection: Connection
  config: Awaited<ReturnType<typeof hermesConfig>>
  key: string
  cwd: string
  session: string
  stored: string
}
export function createHermesAdapter(): AgentAdapter {
  const idle = new Map<string, WarmHermes>()
  const close = async (value: WarmHermes) => {
    // The overlay contains MCP credentials; keep it until every owned child has exited.
    await value.connection.close()
    await value.config.close()
  }
  return {
    models: hermesModels,
    probe: async (agent) => {
      const connection = openHermesConnection(agent, homedir())
      try {
        await connection.ready()
        await connection.request('client.capabilities', { server_requests: true }, undefined, 30000)
        return {
          provider: 'hermes',
          available: true,
          detail:
            'Hermes native gateway is available. Credentials, memory and skills use its existing home.',
        }
      } catch (error) {
        return {
          provider: 'hermes',
          available: false,
          detail: `Install or update Hermes on this runtime and select its hermes executable. An explicit Hermes Python interpreter is also supported. ${error instanceof Error ? error.message : String(error)}`,
        }
      } finally {
        await connection.close()
      }
    },
    async run(run) {
      run.signal.throwIfAborted()
      if (run.agent.permission === 'read-only' || run.tools === 'none')
        throw new Error(
          'Hermes native sessions do not provide restricted tool-free execution. Choose another provider for read-only tasks, titles and dictation.',
        )
      const key = JSON.stringify(run.agent)
      const previous = run.taskId ? idle.get(run.taskId) : undefined
      if (run.taskId) idle.delete(run.taskId)
      let warm =
        previous &&
        previous.key === key &&
        previous.cwd === run.cwd &&
        previous.stored === run.sessionId &&
        !previous.connection.signal.aborted
          ? previous
          : undefined
      if (previous && !warm) await close(previous)
      if (!warm) {
        const config = await hermesConfig(run.agent)
        try {
          warm = {
            connection: openHermesConnection(run.agent, run.cwd, config.directory),
            config,
            key,
            cwd: run.cwd,
            stored: '',
            session: '',
          }
        } catch (error) {
          await config.close()
          throw error
        }
      }
      const owned = warm,
        connection = owned.connection
      let settled = false,
        admitted = false,
        segment = ''
      let resolveTurn: () => void = () => {},
        rejectTurn: (error: unknown) => void = () => {}
      const completed = new Promise<void>((resolve, reject) => {
        resolveTurn = resolve
        rejectTurn = reject
      })
      void completed.catch(() => {})
      const questions = new Map<string, AbortController>()
      const reconcile = (value: string, previewed = false) => {
        if (!value.trim() || (previewed && !segment)) return
        if (value.startsWith(segment)) run.onText(value.slice(segment.length))
        else if (run.onTextReplace) run.onTextReplace(value, segment.length)
        else throw new Error('This Hermes consumer does not support finalized text replacement')
        segment = value
      }
      const accept = () => {
        if (admitted || settled) return
        admitted = true
        run.onPromptAccepted?.()
        run.onSteer?.(async (input) => {
          if (settled || run.signal.aborted) throw new Error('This Hermes turn has ended')
          if (input.attachments?.length)
            throw new Error(
              'Hermes steering accepts text only; send attachments in a follow-up turn',
            )
          const response = object(
            await connection.request(
              'session.steer',
              { session_id: owned.session, text: input.prompt },
              run.signal,
              30000,
            ),
          )
          if (response.status !== 'queued')
            throw new Error('Hermes did not accept the steering input')
        })
      }
      connection.events.handle = (raw) => {
        try {
          const event = object(raw),
            name = text(event.type),
            payload = object(event.payload)
          if (name === 'request.cancel') {
            questions.get(text(payload.id))?.abort(new Error('Hermes withdrew this request'))
            return
          }
          if (!owned.session || event.session_id !== owned.session || settled || run.signal.aborted)
            return
          run.onEvent?.(name, payload)
          if (name === 'message.start' || name === 'message.delta' || name === 'tool.start')
            accept()
          if (name === 'message.delta') {
            const delta = text(payload.text)
            segment += delta
            run.onText(delta)
          }
          if (name === 'message.interim') {
            reconcile(text(payload.text), payload.already_streamed === true)
            run.onTextBoundary?.()
            segment = ''
          }
          if (name === 'status.update' && text(payload.text)) run.onActivity(text(payload.text))
          if (name === 'tool.start') run.onActivity(`Using ${text(payload.name) || 'tool'}`)
          if (name === 'error') throw new Error(text(payload.message) || 'Hermes gateway failed')
          if (name === 'message.complete') {
            reconcile(text(payload.text), payload.response_previewed === true)
            settled = true
            run.onSteer?.(undefined)
            if (payload.status === 'error')
              throw new Error(text(payload.error) || text(payload.text) || 'Hermes turn failed')
            if (payload.status === 'interrupted') throw new Error('Hermes turn was interrupted')
            resolveTurn()
          }
        } catch (error) {
          settled = true
          rejectTurn(error)
        }
      }
      connection.requests.handle = async (method, raw, frameId) => {
        const params = object(raw)
        if (settled || run.signal.aborted || params.session_id !== owned.session)
          throw new Error('This Hermes request belongs to a retired session')
        const controller = new AbortController()
        questions.set(frameId, controller)
        const signal = AbortSignal.any([run.signal, connection.signal, controller.signal])
        try {
          if (method === 'approval') {
            const allowed =
              run.agent.permission === 'full-access' ||
              (run.agent.permission === 'workspace-write' &&
                ['file_write', 'file_patch'].includes(text(params.tool_name))) ||
              (await nativeWait(
                run.approve(
                  text(params.description) || 'Hermes tool request',
                  text(params.command),
                ),
                signal,
              ))
            return { choice: !signal.aborted && !settled && allowed ? 'once' : 'deny' }
          }
          if (method === 'clarify') return await hermesQuestions(params, run, signal)
          throw new ResponseError(
            ErrorCodes.MethodNotFound,
            `Dovo does not support Hermes request ${method}`,
          )
        } finally {
          questions.delete(frameId)
        }
      }
      let successful = false
      try {
        await connection.ready(run.signal)
        await connection.request(
          'client.capabilities',
          { server_requests: true },
          run.signal,
          30000,
        )
        if (!owned.session) {
          const created = object(
            await connection.request(
              run.sessionId ? 'session.resume' : 'session.create',
              run.sessionId
                ? { session_id: run.sessionId, omit_messages: true, close_on_disconnect: true }
                : {
                    cwd: run.cwd,
                    source: 'dovo',
                    close_on_disconnect: true,
                    hidden: !!run.ephemeral,
                  },
              run.signal,
              30000,
            ),
          )
          owned.session = text(created.session_id)
          owned.stored =
            text(created.stored_session_id) || text(created.resumed) || run.sessionId || ''
          if (!owned.session || !owned.stored)
            throw new Error('Hermes did not return a durable session identity')
          if (created.running === true || created.auto_continue)
            throw new Error(
              'This Hermes session already has a running turn; stop it in Hermes before resuming in Dovo',
            )
          run.onSession(owned.stored)
          if (run.sessionId)
            await connection.request(
              'session.cwd.set',
              { session_id: owned.session, cwd: run.cwd },
              run.signal,
              30000,
            )
          if (run.agent.model) {
            const value = modelValue(await modelOptions(connection, run.signal), run.agent.model)
            const selected = object(
              await connection.request(
                'config.set',
                {
                  session_id: owned.session,
                  key: 'model',
                  value,
                  scope: 'session',
                },
                run.signal,
                30000,
              ),
            )
            if (selected.confirm_required)
              throw new Error(
                text(selected.confirm_message) ||
                  'Hermes requires confirmation for this model; configure it in Hermes first',
              )
          }
          if (run.agent.reasoning)
            await connection.request(
              'config.set',
              {
                session_id: owned.session,
                key: 'reasoning',
                value: run.agent.reasoning,
                scope: 'session',
              },
              run.signal,
              30000,
            )
        } else run.onSession(owned.stored)
        if (run.compact) {
          const compacted = object(
            await connection.request('session.compress', { session_id: owned.session }, run.signal),
          )
          if (compacted.status !== 'compressed')
            throw new Error(
              text(compacted.message) || 'Hermes did not complete context compression',
            )
          run.onEvent?.('session.usage', { usage: compacted.usage })
          run.onEvent?.('dovo/compaction/completed', { sessionId: owned.stored })
          run.onActivity('Hermes context compacted')
          settled = true
        } else {
          for (const attachment of (run.attachments ?? []).filter(isImageAttachment))
            await connection.request(
              'image.attach',
              { session_id: owned.session, path: attachment.path },
              run.signal,
              30000,
            )
          const result = object(
            await connection.request(
              'prompt.submit',
              {
                session_id: owned.session,
                text: [run.agent.instructions, run.prompt].filter(Boolean).join('\n\n'),
              },
              run.signal,
              30000,
            ),
          )
          if (result.status !== 'streaming')
            throw new Error('Hermes did not admit a new streaming turn')
          accept()
          await waitForTurn(completed, connection.signal, run.signal)
        }
        successful = true
      } finally {
        settled = true
        run.onSteer?.(undefined)
        for (const question of questions.values()) question.abort()
        connection.events.handle = undefined
        connection.requests.handle = undefined
        if (run.signal.aborted && owned.session && !connection.signal.aborted) {
          try {
            await connection.request(
              'session.interrupt',
              { session_id: owned.session },
              undefined,
              2000,
            )
          } catch (error) {
            run.onActivity(
              `Hermes interrupt: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        if (
          successful &&
          run.taskId &&
          !run.ephemeral &&
          !run.signal.aborted &&
          !connection.signal.aborted &&
          !releaseIdleProvider()
        )
          idle.set(run.taskId, owned)
        else await close(owned)
      }
    },
    async dispose() {
      const connections = [...idle.values()]
      idle.clear()
      const results = await Promise.allSettled(connections.map(close))
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      )
      if (failures.length) throw new AggregateError(failures, 'Could not close Hermes gateways')
    },
  }
}
async function waitForTurn(completed: Promise<void>, ...signals: AbortSignal[]) {
  const signal = AbortSignal.any(signals)
  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    completed.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
async function hermesQuestions(
  params: Record<string, unknown>,
  run: AgentRun,
  signal: AbortSignal,
) {
  const questions = decode(
    mutableArray(
      mutableStruct({
        qid: Schema.String,
        question: Schema.String,
        choices: Schema.optional(Schema.NullOr(mutableArray(Schema.String))),
        multi_select: Schema.optional(Schema.Boolean),
      }),
    ),
    params.questions,
  )
  const answers = await run.ask(
    decode(questionPromptSchema, {
      title: 'Hermes needs your input',
      questions: questions.map((question) => ({
        id: question.qid,
        header: 'Question',
        question: question.question,
        options: (question.choices ?? []).map((label) => ({ value: label, label })),
        custom: true,
        multiple: question.multi_select ?? false,
      })),
    }),
    signal,
  )
  return {
    answers:
      answers && !signal.aborted
        ? Object.fromEntries(
            questions.map((question) => [question.qid, (answers[question.qid] ?? []).join(', ')]),
          )
        : {},
  }
}
