import { reconcileComposerDraft } from './draft-reconciliation'

/**
 * Own pending persistence independently of React renders and request completion.
 *
 * `write` receives `expected` when the write is a send acknowledgement: it must only replace a
 * persisted draft that still holds the submitted text. A delayed acknowledgement can arrive
 * after this controller's thread was left and reopened, when a newer composer owns the draft.
 */
export function createComposerDraft(
  initial: string,
  write: (text: string, expected?: string) => void,
  onError: (cause: unknown) => void = () => {},
  protect: (text: string, expected?: string) => boolean | void = () => {},
) {
  const listeners = new Set<() => void>()
  const publish = () => listeners.forEach((listener) => listener())
  let text = initial
  let observed = initial
  let revision = 0
  let dirty = false
  let protectedRevision = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let expected: string | undefined
  let protectionExpected: string | undefined
  const consumed = new Set<string>()
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const flush = () => {
    cancel()
    if (!dirty) return
    if (protectedRevision !== revision) {
      if (protect(text, protectionExpected ?? expected) === false) {
        dirty = false
        expected = undefined
        protectionExpected = undefined
        return
      }
      protectedRevision = revision
    }
    if (expected === undefined) write(text)
    else write(text, expected)
    dirty = false
    expected = undefined
    protectionExpected = undefined
  }
  return {
    rebind(writer: (text: string, expected?: string) => void) {
      write = writer
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    get text() {
      return text
    },
    get revision() {
      return revision
    },
    update(value: string) {
      text = value
      revision++
      dirty = true
      expected = undefined
      protectionExpected = undefined
      try {
        protect(text)
        protectedRevision = revision
      } catch (cause) {
        onError(cause)
      }
      publish()
      cancel()
      timer = setTimeout(() => {
        try {
          flush()
        } catch (cause) {
          onError(cause)
        }
      }, 300)
      return text
    },
    receive(value: string) {
      // Suppress consumed text until a replacement is observed. A later independent
      // write may legitimately contain the same text again. The workspace layer
      // orders remote snapshots and retains unacknowledged local patches.
      if (!dirty && (value === text || (value !== observed && !consumed.has(value.trim()))))
        consumed.clear()
      if (!dirty && !consumed.has(value.trim())) {
        const previous = text
        text = reconcileComposerDraft(text, text, value, null, observed)
        if (text !== previous) revision++
      }
      observed = value
      publish()
      return text
    },
    accept(submitted: string, expectedRevision = revision) {
      cancel()
      consumed.add(submitted.trim())
      if (text.trim() === submitted.trim() && revision === expectedRevision) {
        // A persisted send clears only the submitted text; another composer may since have
        // saved a newer draft. Unpersisted local text keeps the unconditional write.
        if (!dirty) expected = text
        protectionExpected = text
        text = ''
        revision++
      }
      dirty = true
      publish()
      flush()
      return text
    },
    flush,
  }
}
