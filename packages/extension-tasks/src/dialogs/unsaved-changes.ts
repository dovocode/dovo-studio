/** Explicit dismissal can discard edits; incidental dismissal must ask first. */
export function confirmDiscardChanges(dirty: boolean) {
  return !dirty || window.confirm('Discard your unsaved changes?')
}
