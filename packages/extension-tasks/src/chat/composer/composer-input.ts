/**
 * The composer's input is a textarea in Markdown source mode and a rich editor otherwise.
 * Callers read and place the caret in Markdown source offsets through these helpers, so
 * dictation, history recall and mentions behave the same in both modes.
 */
export type ComposerSelectionHandle = {
  selection(): { start: number; end: number }
  select(start: number, end: number): void
}

const handles = new WeakMap<Element, ComposerSelectionHandle>()

export function registerComposerInput(element: Element, handle: ComposerSelectionHandle) {
  handles.set(element, handle)
  return () => {
    if (handles.get(element) === handle) handles.delete(element)
  }
}

export function composerSelection(element: Element | null | undefined, fallback: number) {
  if (element instanceof HTMLTextAreaElement)
    return { start: element.selectionStart, end: element.selectionEnd }
  return (element && handles.get(element)?.selection()) ?? { start: fallback, end: fallback }
}

export function selectComposerInput(
  element: Element | null | undefined,
  start: number,
  end = start,
) {
  if (element instanceof HTMLTextAreaElement) element.setSelectionRange(start, end)
  else if (element) handles.get(element)?.select(start, end)
}
