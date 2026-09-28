export type DraftSelection = { start: number; end: number }

/** Keep the surrounding draft untouched while recognition revises the spoken fragment. */
export function dictationInsertion(draft: string, selection?: DraftSelection) {
  const start = Math.max(0, Math.min(selection?.start ?? draft.length, draft.length))
  const end = Math.max(start, Math.min(selection?.end ?? start, draft.length))
  const before = draft.slice(0, start)
  const after = draft.slice(end)
  return (transcript: string) => {
    if (!transcript.trim()) return draft
    const words = transcript.trim()
    const left = before && !/\s$/.test(before) ? ' ' : ''
    const right = after && !/^[\s.,!?;:)}\]]/.test(after) ? ' ' : ''
    return before + left + words + right + after
  }
}

/** A cleanup result may only replace the revision that requested it. */
export class DictationDraftEdit {
  private valid = true
  private insert: (transcript: string) => string
  private expected: string
  constructor(draft: string, selection?: DraftSelection) {
    this.insert = dictationInsertion(draft, selection)
    this.expected = draft
  }
  invalidate() {
    this.valid = false
  }
  preview(transcript: string) {
    this.expected = this.insert(transcript)
    return this.expected
  }
  clean(current: string, transcript: string) {
    if (!this.valid || current !== this.expected) return null
    this.expected = this.insert(transcript)
    return this.expected
  }
}
