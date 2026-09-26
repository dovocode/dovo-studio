import { useDiffOptions } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useMemo, useRef } from 'react'
import { parseDiffFromFile, preloadHighlighter, getFiletypeFromFileName } from '@pierre/diffs'
import { Editor } from '@pierre/diffs/edit'
import {
  EditProvider,
  FileDiff,
  type EditorFactory,
  type FileDiffOptions,
} from '@pierre/diffs/react'
import { Button, LineCommentForm, MessageResponse } from '@dovo/studio-ui'
import type { ChangedFile, Task } from '@dovo/studio-core'
const createEditor: EditorFactory<undefined, undefined> = (type, options, key) =>
  new Editor(type, options, key)
export function PierreEditor({
  file,
  taskId,
  onSave,
  comments,
  onComment,
}: {
  file: ChangedFile
  taskId: string
  comments: Task['messages']
  onComment: (
    body: string,
    range: {
      start: number
      end: number
      side: 'additions' | 'deletions'
    },
  ) => Promise<void>
  onSave: (contents: string) => void
}) {
  const [ready, setReady] = useApplicationState(false)
  const [loadError, setLoadError] = useApplicationState<Error | null>(null)
  useEffect(() => {
    let cancelled = false
    // Prepare syntax resources before mounting the imperative diff renderer.
    preloadHighlighter({
      themes: ['pierre-dark', 'pierre-light'],
      langs: [getFiletypeFromFileName(file.path)],
    })
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error : new Error(String(error)))
      })
    return () => {
      cancelled = true
    }
  }, [file.path])
  const [selection, setSelection] = useApplicationState<{
    start: number
    end: number
    side: 'additions' | 'deletions'
  } | null>(null)
  const [editing, setEditing] = useApplicationState(false)
  const diffs = useDiffOptions()
  const [split, setSplit] = useApplicationState(diffs.defaultSplit)
  const [dirty, setDirty] = useApplicationState(false)
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const diff = useMemo(
    () =>
      parseDiffFromFile(
        {
          name: file.path,
          contents: file.before,
        },
        {
          name: file.path,
          contents: file.after,
        },
      ),
    [file.path, file.before, file.after],
  )
  const options = useMemo<FileDiffOptions<undefined, undefined>>(
    () => ({
      ...diffs.options,
      diffStyle: split ? 'split' : 'unified',
      disableFileHeader: true,
      enableLineSelection: !editing,
      enableGutterUtility: !editing,
      onLineSelectionEnd: (range) => {
        if (range && range.start !== range.end && (!range.endSide || range.endSide === range.side))
          setSelection({
            start: Math.min(range.start, range.end),
            end: Math.max(range.start, range.end),
            side: range.side ?? 'additions',
          })
      },
      onGutterUtilityClick: (range) => {
        if (!range.endSide || range.endSide === range.side)
          setSelection({
            start: Math.min(range.start, range.end),
            end: Math.max(range.start, range.end),
            side: range.side ?? 'additions',
          })
      },
    }),
    [split, editing, diffs.options],
  )
  const anchored = comments.filter((m) => {
    const c = m.diffComment
    return (
      m.file === file.path &&
      c &&
      (c.side === 'additions' ? file.after : file.before)
        .split('\n')
        .slice(c.start - 1, c.end)
        .join('\n') === c.excerpt
    )
  })
  const anchors = [
    ...new Map(
      anchored.flatMap((m) =>
        m.diffComment
          ? [
              [
                `${m.diffComment.side}:${m.diffComment.end}`,
                {
                  lineNumber: m.diffComment.end,
                  side: m.diffComment.side,
                },
              ] as const,
            ]
          : [],
      ),
    ).values(),
  ]
  if (
    selection &&
    !anchors.some((a) => a.side === selection.side && a.lineNumber === selection.end)
  )
    anchors.push({
      lineNumber: selection.end,
      side: selection.side,
    })
  if (loadError) throw loadError
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-muted-foreground">
          {file.path}
          {dirty ? ' •' : ''}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[0.625rem]"
          onClick={() => setSplit((v) => !v)}
        >
          {split ? 'Split' : 'Unified'}
        </Button>
        <Button
          size="sm"
          disabled={!!selection}
          variant={editing ? 'default' : 'outline'}
          className="h-6 px-2 text-[0.625rem]"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? 'Save draft' : 'Edit'}
        </Button>
      </div>
      <div className="studio-code min-h-0 flex-1 overflow-auto">
        <EditProvider createEditor={createEditor}>
          {ready ? (
            <FileDiff
              fileDiff={diff}
              lineAnnotations={anchors}
              renderAnnotation={(annotation) => (
                <div className="space-y-2 p-2">
                  {anchored
                    .filter(
                      (m) =>
                        m.diffComment?.side === annotation.side &&
                        m.diffComment.end === annotation.lineNumber,
                    )
                    .map((m) => (
                      <div key={m.id} className="rounded border bg-background p-2 text-xs">
                        <strong>Agent steering</strong>
                        <MessageResponse>{m.diffComment?.body ?? ''}</MessageResponse>
                      </div>
                    ))}
                  {selection &&
                    selection.side === annotation.side &&
                    selection.end === annotation.lineNumber && (
                      <LineCommentForm
                        key={`${selection.side}:${selection.start}:${selection.end}`}
                        selectedCode={
                          selection.side === 'additions'
                            ? file.after
                                .split('\n')
                                .slice(selection.start - 1, selection.end)
                                .join('\n')
                            : undefined
                        }
                        label={`${file.path}:${selection.start}–${selection.end} (${selection.side === 'additions' ? 'new' : 'old'})`}
                        submitLabel="Add steering to chat"
                        onCancel={() => setSelection(null)}
                        onSubmit={async (body) => {
                          await onComment(body, selection)
                          setSelection(null)
                        }}
                      />
                    )}
                </div>
              )}
              options={options}
              edit={editing}
              editStateKey={`${taskId}:${file.path}`}
              onEditChange={() => setDirty(true)}
              onEditComplete={(event) => {
                saveRef.current(event.newFile?.contents ?? '')
                setDirty(false)
                return 'accept'
              }}
            />
          ) : (
            <p className="p-4 text-xs text-muted-foreground">Loading diff…</p>
          )}
        </EditProvider>
      </div>
      {comments
        .filter((m) => m.file === file.path && m.diffComment && !anchored.includes(m))
        .map((m) => (
          <p key={m.id} className="border-t px-3 py-2 text-xs">
            <strong>
              Earlier snapshot · Line {m.diffComment?.start} (
              {m.diffComment?.side === 'additions' ? 'new' : 'old'})
            </strong>{' '}
            · {m.diffComment?.body}
          </p>
        ))}
      <div className="border-t px-3 py-1 text-[0.625rem] text-muted-foreground">
        {editing
          ? 'Editing draft · ⌘Z undo · ⌘F find · saved when leaving this file'
          : 'Drag line numbers or Shift-click for a range · Click + for one line · Edit changes file contents'}
      </div>
    </div>
  )
}
