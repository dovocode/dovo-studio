import { reconcileComposerDraft } from './draft-reconciliation'

/** Own pending persistence independently of React renders and request completion. */
export function createComposerDraft(
  initial: string,
  write: (text: string) => void,
  onError: (cause: unknown) => void = () => {},
) {
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
    get text() {
      return text
    },
    update(value: string) {
      text = value
      dirty = true
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
      return text
    },
    accept(submitted: string) {
      consumed.add(submitted.trim())
      cancel()
      if (text.trim() === submitted.trim()) text = ''
      dirty = true
      flush()
      return text
    },
    flush,
  }
}
