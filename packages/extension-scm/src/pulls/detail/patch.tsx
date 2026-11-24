import { useApplicationState } from '@dovo/studio-core/state'
import { Button, ChoicePicker, LineCommentForm } from '@dovo/studio-ui'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { preloadStudioHighlighter, useDiffOptions } from '@dovo/studio-ui/code-themes'
import { selectedPatchCode } from './selected-code'
import { reviewPatch } from './review-patch'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { getFiletypeFromFileName, parsePatchFiles } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import type { PullDetail } from '@dovo/studio-core'
import { forgeLabels, pullFilePatch, type ForgeProvider } from '@dovo/studio-core'

/** A selected line range, kept with the PR revision and patch it was written against. */
export type PullLineSelection = {
  start: number
  end: number
  side: 'additions' | 'deletions'
  file: PullDetail['files'][number]
  headSha: string
  expectedDestination?: string
}
/** Comment state owned by the file list, so it outlives a file leaving the render window. */
export type PullLineDraft = {
  selection: PullLineSelection | null
  destination: 'github' | 'agent'
  body: string
  suggesting: boolean
  replacement: string
}
export const emptyPullLineDraft: PullLineDraft = {
  selection: null,
  destination: 'agent',
  body: '',
  suggesting: false,
  replacement: '',
}

export function PullPatch({
  file,
  split,
  reviewContext = false,
  focusedLine,
  onComment,
  provider = 'github',
  allowAgent = true,
  agentAction,
  allowInlineComment = true,
  allowInlineRange = true,
  headSha = '',
  expectedDestination,
  draft = emptyPullLineDraft,
  onDraft,
  commentDisabled = false,
}: {
  file: PullDetail['files'][number]
  split: boolean
  reviewContext?: boolean
  focusedLine?: { number: number; side: 'additions' | 'deletions' }
  onComment?: (
    body: string,
    range: {
      start: number
      end: number
      side: 'additions' | 'deletions'
    },
    destination: 'github' | 'agent',
    baseline: {
      headSha: string
      path: string
      patch: string
      expectedDestination?: string
      code?: string
    },
  ) => Promise<void>
  provider?: ForgeProvider
  allowAgent?: boolean
  /**
   * Where agent feedback goes instead of a new task, such as the explicitly linked thread showing
   * this PR or a conversation chooser. `clears` drops the selection once handed off.
   */
  agentAction?: { option: string; submit: string; clears: boolean }
  allowInlineComment?: boolean
  allowInlineRange?: boolean
  headSha?: string
  expectedDestination?: string
  draft?: PullLineDraft
  onDraft?: (update: (draft: PullLineDraft) => PullLineDraft) => void
  commentDisabled?: boolean
}) {
  const uiText = useInterfaceText()
  const keyboardPicker = useRef<HTMLDetailsElement>(null)
  const keyboardSelection = useRef(false)
  const focusKeyboardComment = useCallback((node: HTMLTextAreaElement | null) => {
    if (!node || !keyboardSelection.current) return
    // The textarea connects when Pierre mounts its annotation slot.
    const frame = requestAnimationFrame(() => node.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  const [lineError, setLineError] = useApplicationState(false)
  const { selection } = draft
  const destination = allowAgent ? draft.destination : 'github'
  const setSelection = (next: PullLineSelection | null) =>
    onDraft?.((current) =>
      next
        ? {
            ...current,
            selection: next,
            replacement: current.selection
              ? current.replacement
              : next.side === 'additions' && parsed.diff
                ? (selectedPatchCode(parsed.diff, next.start, next.end) ?? '')
                : '',
          }
        : { ...emptyPullLineDraft, destination: current.destination },
    )
  const setDestination = (next: PullLineDraft['destination']) =>
    onDraft?.((current) => ({ ...current, destination: next }))
  const closeComment = () => {
    setSelection(null)
    if (keyboardSelection.current) {
      keyboardSelection.current = false
      keyboardPicker.current?.querySelector('summary')?.focus()
    }
  }
  const diffs = useDiffOptions()
  const [ready, setReady] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const [highlightAttempt, setHighlightAttempt] = useApplicationState(0)
  const scrollToFocusedLine = useCallback((node: HTMLSpanElement | null) => {
    if (!node) return
    const frame = requestAnimationFrame(() => node.scrollIntoView({ block: 'center' }))
    return () => cancelAnimationFrame(frame)
  }, [])
  // Keep the original diff and range mounted while a push refreshes the live PR.
  const draftFile = selection?.file ?? file
  const binary = !!file.attributes?.binary && !selection
  const parsed = useMemo(() => {
    if (binary) return { diff: undefined, error: '' }
    try {
      const diff = parsePatchFiles(
        pullFilePatch(
          reviewContext && draftFile.patch
            ? {
                ...draftFile,
                patch: reviewPatch(draftFile.patch),
              }
            : draftFile,
        ),
        { throwOnError: true },
      )[0]?.files[0]
      return {
        diff: diff
          ? {
              ...diff,
              name: draftFile.path,
              // Discard the synthetic old filename; unchanged paths use name on both sides.
              prevName: draftFile.previousPath,
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
  }, [
    draftFile.path,
    draftFile.previousPath,
    draftFile.patch,
    draftFile.status,
    draftFile.additions,
    draftFile.deletions,
    reviewContext,
    binary,
  ])
  useEffect(() => {
    let stopped = false
    setReady(false)
    setError('')
    if (binary) return
    const languages = new Set([
      getFiletypeFromFileName(draftFile.path),
      getFiletypeFromFileName(draftFile.previousPath ?? draftFile.path),
    ])
    void Promise.all([...languages].map(preloadStudioHighlighter))
      .then(() => {
        if (!stopped) setReady(true)
      })
      .catch((e) => {
        if (!stopped) setError(String(e))
      })
    return () => {
      stopped = true
    }
  }, [draftFile.path, draftFile.previousPath, highlightAttempt, binary])
  if (binary)
    return (
      <p className="p-4 text-xs text-muted-foreground">
        Text diff disabled by .gitattributes (binary or -diff).
      </p>
    )
  if (!draftFile.patch)
    return (
      <p className="p-4 text-xs text-muted-foreground">
        {forgeLabels[provider]} has no text patch for this file (binary, large, or rename-only).
        Open the PR on
        {forgeLabels[provider]} for the full file.
      </p>
    )
  if (error || parsed.error || !parsed.diff)
    return (
      <div className="min-w-0 space-y-2 p-4 text-xs">
        <p role="alert" className="[overflow-wrap:anywhere] text-destructive">
          Could not render this patch. {error || parsed.error} Showing the text patch.
        </p>
        {error && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setHighlightAttempt((attempt) => attempt + 1)}
          >
            Retry highlighting
          </Button>
        )}
        <pre className="overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]">
          {draftFile.patch}
        </pre>
      </div>
    )
  return (
    <div
      className="min-w-0 overflow-auto"
      title={
        onComment
          ? 'Drag line numbers or Shift-click for a range. Click + for a single line.'
          : undefined
      }
      style={{
        fontSize: 12,
      }}
    >
      {reviewContext && (
        <p className="py-2 text-[0.625rem] text-muted-foreground">
          Review excerpt · original line numbers; surrounding changes may be omitted.
        </p>
      )}
      {selection && selection.headSha !== headSha && (
        <p role="status" className="py-2 text-xs text-muted-foreground">
          This draft refers to an earlier PR revision. Your text is preserved; select lines on the
          current revision before posting to the PR, or send this feedback to an agent.
        </p>
      )}
      {ready && onComment && !commentDisabled && !focusedLine && onDraft && (
        <details ref={keyboardPicker} className="border-b px-3 py-2 text-xs">
          <summary className="w-fit cursor-pointer rounded-sm focus-visible:ring-2 focus-visible:ring-ring">
            {uiText('Comment on line')}
          </summary>
          <form
            className="flex flex-wrap items-end gap-2 pt-2"
            onChange={() => setLineError(false)}
            onSubmit={(event) => {
              event.preventDefault()
              const fields = new FormData(event.currentTarget)
              const number = Number(fields.get('line'))
              const side = fields.get('side') === 'deletions' ? 'deletions' : 'additions'
              const visible = parsed.diff?.hunks.some((hunk) => {
                const start = side === 'additions' ? hunk.additionStart : hunk.deletionStart
                const count = side === 'additions' ? hunk.additionCount : hunk.deletionCount
                return number >= start && number < start + count
              })
              if (!Number.isSafeInteger(number) || !visible) {
                setLineError(true)
                return
              }
              keyboardSelection.current = true
              if (keyboardPicker.current) keyboardPicker.current.open = false
              setSelection({
                start: number,
                end: number,
                side,
                file: draftFile,
                headSha: selection?.headSha ?? headSha,
                expectedDestination: selection?.expectedDestination ?? expectedDestination,
              })
            }}
          >
            <label className="grid gap-1">
              {uiText('Diff side')}
              <select name="side" className="h-7 rounded border bg-background px-2">
                <option value="additions">{uiText('After')}</option>
                <option value="deletions">{uiText('Before')}</option>
              </select>
            </label>
            <label className="grid gap-1">
              {uiText('Line in the diff')}
              <input
                className="h-7 w-24 rounded border bg-background px-2"
                name="line"
                type="number"
                min={1}
                required
              />
            </label>
            <Button type="submit" size="sm" variant="outline">
              {uiText('Open comment editor')}
            </Button>
            {lineError && (
              <p role="alert" className="w-full text-destructive">
                {uiText('Enter a line shown on the selected side of the diff.')}
              </p>
            )}
          </form>
        </details>
      )}
      {ready ? (
        <FileDiff
          fileDiff={parsed.diff}
          selectedLines={
            focusedLine && {
              start: focusedLine.number,
              end: focusedLine.number,
              side: focusedLine.side,
            }
          }
          lineAnnotations={
            focusedLine
              ? [{ lineNumber: focusedLine.number, side: focusedLine.side }]
              : selection
                ? [
                    {
                      lineNumber: selection.end,
                      side: selection.side,
                    },
                  ]
                : []
          }
          renderAnnotation={() =>
            focusedLine ? (
              <span ref={scrollToFocusedLine} />
            ) : (
              selection && (
                <LineCommentForm
                  key={`${selection.side}:${selection.start}:${selection.end}`}
                  selectedCode={
                    selection.side === 'additions'
                      ? selectedPatchCode(parsed.diff, selection.start, selection.end)
                      : undefined
                  }
                  label={`${file.path}:${selection.start}–${selection.end}`}
                  commentRef={focusKeyboardComment}
                  draft={draft}
                  onDraft={(value) => onDraft?.((current) => ({ ...current, ...value }))}
                  disabled={commentDisabled || !onComment}
                  submitLabel={
                    destination === 'github'
                      ? `Post to ${forgeLabels[provider]}`
                      : (agentAction?.submit ?? 'Start agent thread')
                  }
                  onCancel={closeComment}
                  onSubmit={async (body) => {
                    if (!onComment || commentDisabled) return
                    if (
                      destination === 'github' &&
                      !allowInlineRange &&
                      selection.start !== selection.end
                    )
                      throw new Error(
                        'This provider accepts one line per comment. Select a single line or send the range to an agent thread.',
                      )
                    await onComment(
                      body,
                      { start: selection.start, end: selection.end, side: selection.side },
                      destination,
                      {
                        headSha: selection.headSha,
                        expectedDestination: selection.expectedDestination,
                        path: selection.file.path,
                        patch: selection.file.patch ?? '',
                        code:
                          selection.side === 'additions'
                            ? selectedPatchCode(parsed.diff, selection.start, selection.end)
                            : undefined,
                      },
                    )
                    if (destination === 'github' || agentAction?.clears) closeComment()
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
                    {allowAgent && (
                      <option value="agent">{agentAction?.option ?? 'Agent thread'}</option>
                    )}
                    {allowInlineComment && (
                      <option value="github">{forgeLabels[provider]} PR</option>
                    )}
                  </ChoicePicker>
                </LineCommentForm>
              )
            )
          }
          options={{
            ...diffs.options,
            diffStyle: split ? 'split' : 'unified',
            disableFileHeader: true,
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
                  file: draftFile,
                  headSha: selection?.headSha ?? headSha,
                  expectedDestination: selection?.expectedDestination ?? expectedDestination,
                })
            },
            onGutterUtilityClick: (range) => {
              if (!range.endSide || range.endSide === range.side)
                setSelection({
                  start: Math.min(range.start, range.end),
                  end: Math.max(range.start, range.end),
                  side: range.side ?? 'additions',
                  file: draftFile,
                  headSha: selection?.headSha ?? headSha,
                  expectedDestination: selection?.expectedDestination ?? expectedDestination,
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
