import { useApplicationState } from '@dovo/studio-core/state'
import { ChoicePicker } from '@dovo/studio-ui'
import { selectedPatchCode } from './selected-code'
import { LineCommentForm } from '@dovo/studio-ui'
import { reviewPatch } from './review-patch'
import { useEffect, useMemo } from 'react'
import { getFiletypeFromFileName, parsePatchFiles, preloadHighlighter } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import type { PullDetail } from '@dovo/studio-core'
import { forgeLabels, pullFilePatch, type ForgeProvider } from '@dovo/studio-core'
export function PullPatch({
  file,
  split,
  reviewContext = false,
  onComment,
  provider = 'github',
  allowInlineComment = true,
  allowInlineRange = true,
}: {
  file: PullDetail['files'][number]
  split: boolean
  reviewContext?: boolean
  onComment?: (
    body: string,
    range: {
      start: number
      end: number
      side: 'additions' | 'deletions'
    },
    destination: 'github' | 'agent',
  ) => Promise<void>
  provider?: ForgeProvider
  allowInlineComment?: boolean
  allowInlineRange?: boolean
}) {
  const [selection, setSelection] = useApplicationState<{
    start: number
    end: number
    side: 'additions' | 'deletions'
  } | null>(null)
  const [destination, setDestination] = useApplicationState<'github' | 'agent'>('agent')
  const [ready, setReady] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const parsed = useMemo(() => {
    try {
      const diff = parsePatchFiles(
        pullFilePatch(
          reviewContext && file.patch
            ? {
                ...file,
                patch: reviewPatch(file.patch),
              }
            : file,
        ),
        undefined,
        true,
      )[0]?.files[0]
      return {
        diff: diff
          ? {
              ...diff,
              name: file.path,
              prevName: file.previousPath ?? diff.prevName,
            }
          : undefined,
        error: '',
      }
    } catch (error) {
      return {
        diff: undefined,
        error: String(error),
      }
    }
  }, [file, reviewContext])
  useEffect(() => {
    let stopped = false
    setReady(false)
    setError('')
    void preloadHighlighter({
      themes: ['pierre-dark'],
      langs: [getFiletypeFromFileName(file.path)],
    })
      .then(() => {
        if (!stopped) setReady(true)
      })
      .catch((e) => {
        if (!stopped) setError(String(e))
      })
    return () => {
      stopped = true
    }
  }, [file.path])
  if (!file.patch)
    return (
      <p className="p-4 text-xs text-muted-foreground">
        {forgeLabels[provider]} has no text patch for this file (binary, large, or rename-only).
        Open the PR on
        {forgeLabels[provider]} for the full file.
      </p>
    )
  if (error || parsed.error || !parsed.diff)
    return (
      <p role="alert" className="p-4 text-xs text-destructive">
        Could not render this patch. {error || parsed.error} Open {forgeLabels[provider]} to inspect
        it.
      </p>
    )
  return (
    <div
      className="min-w-0 overflow-auto"
      style={{
        fontSize: 12,
      }}
    >
      {onComment && (
        <p className="py-2 text-[10px] text-muted-foreground">
          Drag line numbers or Shift-click for a range. Click + for a single line.
        </p>
      )}
      {reviewContext && (
        <p className="py-2 text-[10px] text-muted-foreground">
          Review excerpt · original line numbers; surrounding changes may be omitted.
        </p>
      )}
      {ready ? (
        <FileDiff
          fileDiff={parsed.diff}
          lineAnnotations={
            selection
              ? [
                  {
                    lineNumber: selection.end,
                    side: selection.side,
                  },
                ]
              : []
          }
          renderAnnotation={() =>
            selection &&
            onComment && (
              <LineCommentForm
                key={`${selection.side}:${selection.start}:${selection.end}`}
                selectedCode={
                  selection.side === 'additions'
                    ? selectedPatchCode(parsed.diff, selection.start, selection.end)
                    : undefined
                }
                label={`${file.path}:${selection.start}–${selection.end}`}
                submitLabel={
                  destination === 'github' ? `Post to ${forgeLabels[provider]}` : 'Start agent task'
                }
                onCancel={() => setSelection(null)}
                onSubmit={async (body) => {
                  if (
                    destination === 'github' &&
                    !allowInlineRange &&
                    selection.start !== selection.end
                  )
                    throw new Error(
                      'This provider accepts one line per comment. Select a single line or send the range to an agent task.',
                    )
                  await onComment(body, selection, destination)
                  if (destination === 'github') setSelection(null)
                }}
              >
                <ChoicePicker
                  aria-label="Comment destination"
                  className="rounded border bg-background p-1"
                  value={destination}
                  onValueChange={(selection) =>
                    setDestination(selection === 'github' ? 'github' : 'agent')
                  }
                >
                  <option value="agent">Agent task</option>
                  {allowInlineComment && <option value="github">{forgeLabels[provider]} PR</option>}
                </ChoicePicker>
              </LineCommentForm>
            )
          }
          options={{
            theme: 'pierre-dark',
            themeType: 'dark',
            diffStyle: split ? 'split' : 'unified',
            disableFileHeader: true,
            overflow: 'scroll',
            enableLineSelection: !!onComment,
            enableGutterUtility: !!onComment,
            onLineSelectionEnd: (range) => {
              if (
                range &&
                range.start !== range.end &&
                (!range.endSide || range.endSide === range.side)
              )
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
          }}
        />
      ) : (
        <p className="p-4 text-xs text-muted-foreground">Preparing code highlighting…</p>
      )}
    </div>
  )
}
