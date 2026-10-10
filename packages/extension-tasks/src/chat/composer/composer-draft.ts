import { reconcileComposerDraft } from './draft-reconciliation'

/** Own pending persistence independently of React renders and request completion. */
export function createComposerDraft(
  initial: string,
  write: (text: string) => void,
  onError: (cause: unknown) => void = () => {},
) {
  const listeners = new Set<() => void>()
  const publish = () => listeners.forEach((listener) => listener())
  let text = initial
  let observed = initial
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const consumed = new Set<string>()
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const flush = () => {
    cancel()
    if (!dirty) return
    write(text)
    dirty = false
  }
  return {
    rebind(writer: (text: string) => void) {
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
    update(value: string) {
      text = value
      dirty = true
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
      // A late snapshot cannot restore a consumed message or replace unsaved typing.
      if (!dirty && !consumed.has(value.trim()))
        text = reconcileComposerDraft(text, text, value, null, observed)
      observed = value
      publish()
      return text
    },
    accept(submitted: string) {
      consumed.add(submitted.trim())
      cancel()
      if (text.trim() === submitted.trim()) text = ''
      publish()
      dirty = true
      flush()
      return text
    },
    flush,
  }
}
