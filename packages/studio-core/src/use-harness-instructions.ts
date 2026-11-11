import { useCallback, useEffect, useRef, useState } from 'react'
import type { Schema } from 'effect'
import {
  harnessInstructionFilesSchema,
  harnessInstructionReadSchema,
  harnessInstructionPreviewSchema,
  harnessInstructionSaveSchema,
  type HarnessInstructionFile,
  type HarnessInstructionRead,
} from '@dovo/protocol'

type Draft = HarnessInstructionRead & {
  original: string
  diff: string
  reviewed: boolean
}
type Editor = {
  files: HarnessInstructionFile[]
  notices: string[]
  selected: string
  drafts: Record<string, Draft>
  busy: boolean
  loading: boolean
  reading: boolean
  error: string
  notice: string
}
const empty: Editor = {
  files: [],
  notices: [],
  selected: '',
  drafts: {},
  busy: false,
  loading: false,
  reading: false,
  error: '',
  notice: '',
}
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** The transport is scoped by the caller. Drafts and async replies remain owned by that computer. */
export function useHarnessInstructions({
  scope,
  connected,
  supported,
  request,
}: {
  scope: string
  connected: boolean
  supported: boolean
  request: <T extends Schema.Codec<unknown, unknown>>(
    path: string,
    input: unknown,
    schema: T,
  ) => Promise<T['Type']>
}) {
  const [editors, setEditors] = useState<Record<string, Editor>>({})
  const [retry, setRetry] = useState(0)
  const pending = useRef(new Set<string>())
  const state = editors[scope] ?? empty
  const update = useCallback(
    (change: (state: Editor) => Editor) => {
      setEditors((current) => ({ ...current, [scope]: change(current[scope] ?? empty) }))
    },
    [scope],
  )
  const selected = state.files.find((file) => file.id === state.selected)
  const id = selected?.id ?? ''
  const draft = state.drafts[id]
  const dirty = Object.values(editors).some((editor) =>
    Object.values(editor.drafts).some((value) => value.text !== value.original),
  )
  useEffect(() => {
    if (!connected || !supported) return
    let active = true
    update((current) => ({ ...current, loading: true, error: '' }))
    void request('/api/agents/instructions/list', {}, harnessInstructionFilesSchema)
      .then((result) => {
        if (active)
          update((current) => {
            const files = [
              ...result.files,
              ...current.files
                .filter(
                  (file) =>
                    !result.files.some((next) => next.id === file.id) &&
                    current.drafts[file.id]?.text !== current.drafts[file.id]?.original,
                )
                .map((file) => ({
                  ...file,
                  description:
                    'This configuration changed. Copy your draft before selecting its replacement.',
                })),
            ]
            return {
              ...current,
              ...result,
              files,
              loading: false,
              selected: files.some((file) => file.id === current.selected)
                ? current.selected
                : (files[0]?.id ?? ''),
            }
          })
      })
      .catch((cause) => {
        if (active) update((current) => ({ ...current, loading: false, error: message(cause) }))
      })
    return () => {
      active = false
    }
  }, [scope, connected, supported, request, retry, update])
  useEffect(() => {
    if (!connected || !supported || !id || draft) return
    let active = true
    update((current) => ({ ...current, reading: true, error: '' }))
    void request('/api/agents/instructions/read', { id }, harnessInstructionReadSchema)
      .then((result) => {
        if (active)
          update((current) => ({
            ...current,
            reading: false,
            drafts: {
              ...current.drafts,
              [id]: { ...result, original: result.text, diff: '', reviewed: false },
            },
          }))
      })
      .catch((cause) => {
        if (active) update((current) => ({ ...current, reading: false, error: message(cause) }))
      })
    return () => {
      active = false
    }
  }, [scope, id, !!draft, connected, supported, request, retry, update])
  const changeDraft = (change: (draft: Draft) => Draft) => {
    update((current) => {
      const previous = current.drafts[id]
      return previous
        ? { ...current, notice: '', drafts: { ...current.drafts, [id]: change(previous) } }
        : current
    })
  }
  const run = async (operation: () => Promise<void>) => {
    if (
      !connected ||
      !supported ||
      state.busy ||
      state.loading ||
      state.reading ||
      pending.current.has(scope)
    )
      return
    pending.current.add(scope)
    update((current) => ({ ...current, busy: true, error: '', notice: '' }))
    try {
      await operation()
    } catch (cause) {
      update((current) => ({ ...current, error: message(cause) }))
    } finally {
      pending.current.delete(scope)
      update((current) => ({ ...current, busy: false }))
    }
  }
  return {
    ...state,
    selected,
    draft,
    dirty,
    loading: state.loading || state.reading,
    disabled: !connected || !supported || state.busy || state.loading || state.reading,
    select: (selected: string) =>
      update((current) => ({ ...current, selected, error: '', notice: '' })),
    text: (text: string) =>
      changeDraft((previous) => ({ ...previous, text, diff: '', reviewed: false })),
    reset: () =>
      changeDraft((previous) => ({
        ...previous,
        text: previous.original,
        diff: '',
        reviewed: false,
      })),
    retry: () => setRetry((value) => value + 1),
    reload: () =>
      run(async () => {
        if (!id) return
        const result = await request(
          '/api/agents/instructions/read',
          { id },
          harnessInstructionReadSchema,
        )
        update((current) => {
          const previous = current.drafts[id]
          const text = previous && previous.text !== previous.original ? previous.text : result.text
          return {
            ...current,
            notice: 'Disk version reloaded. Your draft is kept. Review the diff before saving.',
            drafts: {
              ...current.drafts,
              [id]: { ...result, text, original: result.text, diff: '', reviewed: false },
            },
          }
        })
      }),
    review: () =>
      run(async () => {
        if (!draft || !id) return
        const result = await request(
          '/api/agents/instructions/preview',
          { id, text: draft.text, version: draft.version },
          harnessInstructionPreviewSchema,
        )
        changeDraft((previous) =>
          previous.text === draft.text && previous.version === draft.version
            ? {
                ...previous,
                diff: result.changed ? result.diff : 'No changes',
                reviewed: result.changed,
              }
            : previous,
        )
      }),
    save: () =>
      run(async () => {
        if (!draft?.reviewed || !id) return
        const result = await request(
          '/api/agents/instructions/save',
          { id, text: draft.text, version: draft.version },
          harnessInstructionSaveSchema,
        )
        changeDraft((previous) => ({
          ...previous,
          version: result.version,
          original: draft.text,
          exists: true,
          diff: '',
          reviewed: false,
        }))
        update((current) => ({
          ...current,
          notice: `${selected?.name} saved. New harness sessions read the updated file.`,
        }))
      }),
  }
}
