export type FileDraft = {
  contents: string
  expectedContents: string
  saving: boolean
  error: string
}
export const draftPressureMessage =
  'Draft memory limit reached. Save, download and discard, or shrink existing drafts before editing another file.'
const size = (key: string, draft: Pick<FileDraft, 'contents' | 'expectedContents'>) =>
  2 * (key.length + draft.contents.length + draft.expectedContents.length)

/** Admit editor slots before allocating retained source. Existing editors may grow
 * under pressure; no unsaved text is evicted and no source is persisted locally. */
export class FileDrafts {
  private drafts = new Map<string, FileDraft>()
  private editors = new Map<string, { users: number; bytes: number }>()
  private listeners = new Set<() => void>()
  private revision = 0
  constructor(readonly budget = 50 * 1024 * 1024) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  snapshot = () => this.revision
  get = (key: string) => this.drafts.get(key)
  get bytes() {
    let bytes = 0
    for (const [key, draft] of this.drafts) bytes += size(key, draft)
    for (const [key, editor] of this.editors) if (!this.drafts.has(key)) bytes += editor.bytes
    return bytes
  }
  get pressure() {
    return this.bytes >= this.budget
  }
  isEditing(key: string) {
    return this.editors.has(key)
  }
  get unsafe() {
    return this.drafts.size > 0
  }
  entries() {
    return [...this.drafts].map(([key, draft]) => {
      const fields: unknown = JSON.parse(key)
      if (!Array.isArray(fields) || typeof fields[0] !== 'string' || typeof fields[1] !== 'string')
        throw new Error('Invalid draft identity')
      return { key, scope: fields[0], path: fields[1], draft }
    })
  }
  canBegin(key: string, contents: string) {
    if (this.drafts.has(key) || this.editors.has(key)) return true
    return this.bytes + size(key, { contents, expectedContents: contents }) <= this.budget
  }
  begin(key: string, contents: string) {
    if (!this.canBegin(key, contents)) return false
    const editor = this.editors.get(key)
    this.editors.set(key, {
      users: (editor?.users ?? 0) + 1,
      bytes: size(key, { contents, expectedContents: contents }),
    })
    this.changed()
    return true
  }
  end(key: string) {
    const editor = this.editors.get(key)
    if (!editor) return
    if (editor.users > 1) editor.users--
    else this.editors.delete(key)
    this.changed()
  }
  set(key: string, draft: FileDraft | null) {
    const previous = this.drafts.get(key)
    // Check admission at the state boundary, including projected allocation, not
    // just whether the budget was already exhausted before this edit.
    if (draft && !this.editors.has(key)) {
      const before = previous ? size(key, previous) : 0
      const after = size(key, draft)
      if (after > before && this.bytes - before + after > this.budget) return false
    }
    if (draft) this.drafts.set(key, draft)
    else this.drafts.delete(key)
    this.changed()
    return true
  }
  discard(key: string) {
    if (this.drafts.get(key)?.saving || this.editors.has(key)) return false
    return this.set(key, null)
  }
  private changed() {
    this.revision++
    for (const listener of this.listeners) listener()
  }
}
export const fileDrafts = new FileDrafts()
// Electron's preload exposes window.dovo. Its existing shutdown sequence has no
// unload confirmation flow; only ordinary browsers should intercept navigation.
if (typeof window !== 'undefined' && !Reflect.has(window, 'dovo'))
  window.addEventListener('beforeunload', (event) => {
    if (!fileDrafts.unsafe) return
    event.preventDefault()
    event.returnValue = ''
  })
