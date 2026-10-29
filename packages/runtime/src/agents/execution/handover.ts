import type { ChatMessage } from '@dovo/protocol'
import { HttpError, RuntimeOperationError, errorMessage } from '../../errors.js'
import type { AgentAdapter, AgentRun } from './types.js'

/** A foreground request cannot replace a session that still owns native work. */
export class NativeSessionBusyError extends HttpError {
  constructor(message: string) {
    super(409, message)
  }
}
export const preservesNativeSession = (error: unknown): boolean =>
  error instanceof NativeSessionBusyError ||
  (error instanceof RuntimeOperationError && preservesNativeSession(error.cause))

// A byte budget is deliberately conservative and independent of a provider's tokenizer.
// Leave native instructions, tools, image inputs and output room to the provider.
export const HANDOVER_BYTES = 64_000
const omittedHistory =
  '[Earlier conversation omitted from this provider handover to leave context space. The full transcript remains saved in Dovo. Use the original request, recent conversation and current files; do not assume omitted work is complete.]'

/** Keep requests intact. Only historical messages may be omitted; stored history is untouched. */
export function handoverHistory(
  messages: readonly ChatMessage[],
  pendingIds: ReadonlySet<string>,
  compose: (messages: readonly ChatMessage[], omitted: boolean) => string,
  budget = HANDOVER_BYTES,
) {
  const fits = (selected: readonly ChatMessage[], omitted: boolean) =>
    Buffer.byteLength(compose(selected, omitted), 'utf8') <= budget
  if (fits(messages, false)) return { messages: [...messages], prompt: compose(messages, false) }
  const firstUser = messages.find((message) => message.role === 'user')
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  const required = new Set([firstUser?.id, lastUser?.id, ...pendingIds])
  const selected = new Set(messages.filter((message) => required.has(message.id)).map((m) => m.id))
  const retained = () => messages.filter((message) => selected.has(message.id))
  if (!fits(retained(), true))
    throw new HttpError(
      413,
      'The original request, pending messages and attached context exceed the handover budget. Shorten the pending input or start a new thread with a summary. The saved conversation has not been changed.',
    )
  // Retain a contiguous recent suffix rather than filling gaps with unrelated old fragments.
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (selected.has(message.id)) continue
    selected.add(message.id)
    if (!fits(retained(), true)) {
      selected.delete(message.id)
      break
    }
  }
  const history = retained()
  return { messages: history, prompt: compose(history, true) }
}

export function handoverNotice(omitted: boolean) {
  return omitted ? omittedHistory : ''
}

export function isContextRejection(error: unknown) {
  const message = errorMessage(error)
  return (
    /\b(context_length_exceeded|context_window_exceeded|prompt_too_long)\b/i.test(message) ||
    /\b(?:context (?:window|length)|prompt|input)\b.{0,70}\b(?:exceed(?:ed|s)?|too (?:long|large)|full|exhausted)\b/i.test(
      message,
    )
  )
}

/** Only retry a resumed prompt explicitly rejected before acceptance or any interaction. */
export function recoverContext(
  adapter: Pick<AgentAdapter, 'run'>,
  fresh: (run: AgentRun) => Promise<AgentRun>,
  blocked: () => boolean,
): Pick<AgentAdapter, 'run'> {
  return {
    async run(input) {
      let accepted = false
      const mark = () => {
        accepted = true
      }
      try {
        await adapter.run({
          ...input,
          onPromptAccepted: () => {
            mark()
            input.onPromptAccepted?.()
          },
          onText: (text) => {
            if (text) mark()
            input.onText(text)
          },
          onTextReplace: (text, length) => {
            mark()
            input.onTextReplace?.(text, length)
          },
          onEvent: (name, payload) => {
            // Activity may include tool side effects even if a harness omits acceptance.
            if (/tool|item\/(?:started|completed)|message\/start/i.test(name)) mark()
            input.onEvent?.(name, payload)
          },
          onSteer: (steer) =>
            input.onSteer?.(
              steer
                ? async (message) => {
                    // Merely publishing the callback is harmless; admitting new input is not.
                    mark()
                    await steer(message)
                  }
                : undefined,
            ),
          ask: (...args) => {
            mark()
            return input.ask(...args)
          },
          approve: (...args) => {
            mark()
            return input.approve(...args)
          },
          onQuestions: (prompt) => {
            mark()
            input.onQuestions?.(prompt)
          },
        })
      } catch (error) {
        if (
          !input.sessionId ||
          input.compact ||
          accepted ||
          input.signal.aborted ||
          !isContextRejection(error)
        )
          throw error
        if (blocked())
          throw new NativeSessionBusyError(
            'The provider context is full, but native agents or background commands are still active. Wait for them to finish or stop them before recovering the session.',
          )
        const recovered = await fresh(input)
        input.signal.throwIfAborted()
        // Exactly one fresh attempt. Its errors are surfaced, never retried recursively.
        await adapter.run(recovered)
      }
    },
  }
}
