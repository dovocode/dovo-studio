import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, FolderTree, RefreshCw } from 'lucide-react'
import {
  buildFileTree,
  filePreviewLabel,
  fileTreePaths,
  pullFileKind,
  mutableStruct,
  type ChangedFile,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { responses, useWorkspace } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { FileBrowserTree, FileChangeCounts, IconButton, cn } from '@dovo/studio-ui'
import { CheckpointDiff } from '../files/saved-file-diff'
import { SavedFilePreview } from '../files/saved-file-preview'
import { fileStats } from '../files/presentation'

const revisionResponse = mutableStruct({ revision: Schema.String })

/** Working tree changes for a terminal or project checkout in the workspace tools pane. */
export function CheckoutChanges({
  repositoryId,
  terminalId,
  selected,
  onSelect,
}: {
  repositoryId: string
  terminalId?: string
  /** The parent keeps the selection, so switching pane tabs keeps the open file. */
  selected: string
  onSelect: (path: string) => void
}) {
  const uiText = useInterfaceText()
  const { connected, request, snapshot } = useWorkspace()
  const metadataOnly = snapshot?.selectedCheckoutDiffSupported || undefined
  const watchRevision = snapshot?.checkoutChangesRevisionSupported === true
  const [files, setFiles] = useState<ChangedFile[]>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [listOpen, setListOpen] = useState(true)
  const listId = useId()
  useEffect(() => {
    if (!connected) return
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let loadedRevision: string | undefined
    const path = terminalId ? '/api/terminals/workspace/changes' : '/api/scm/changes'
    const input = terminalId ? { id: terminalId } : { repositoryId }
    const refresh = async (first = false) => {
      try {
        if (!first && document.visibilityState === 'hidden') return
        const revision = watchRevision
          ? await request(path, { ...input, revisionOnly: true }, revisionResponse).then(
              (value) => value.revision,
              () => undefined,
            )
          : undefined
        if (!current || (!first && (!revision || revision === loadedRevision))) return
        setError('')
        setLoading(true)
        const response = await request(
          path,
          metadataOnly ? { ...input, metadataOnly } : input,
          responses.files,
        )
        if (!current) return
        setFiles(response.files)
        loadedRevision = revision
      } catch (cause) {
        if (current) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (current) {
          setLoading(false)
          if (watchRevision) timer = setTimeout(() => void refresh(), 4000)
        }
      }
    }
    void refresh(true)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [attempt, connected, repositoryId, request, terminalId, metadataOnly, watchRevision])
  const entries = useMemo(
    () =>
      (files ?? []).map((file) => {
        const stats = file.preview ? undefined : fileStats(file)
        return {
          path: file.path,
          changeKind: pullFileKind(file),
          label: file.preview ? filePreviewLabel(file) : undefined,
          additions: stats?.additions,
          deletions: stats?.deletions,
        }
      }),
    [files],
  )
  const order = useMemo(() => fileTreePaths(buildFileTree(entries)), [entries])
  // When a refresh removes the open file, stay at the same place in the list.
  const lastIndex = useRef(0)
  const path = order.includes(selected)
    ? selected
    : order[Math.min(lastIndex.current, order.length - 1)]
  const index = path === undefined ? -1 : order.indexOf(path)
  if (index >= 0) lastIndex.current = index
  const file = files?.find((item) => item.path === path)
  const additions = entries.reduce((total, entry) => total + (entry.additions ?? 0), 0)
  const deletions = entries.reduce((total, entry) => total + (entry.deletions ?? 0), 0)
  const previous = index > 0 ? order[index - 1] : undefined
  const next = index >= 0 ? order[index + 1] : undefined
  return (
    <section
      aria-label={uiText('Checkout changes')}
      className="flex min-h-0 min-w-0 flex-1 flex-col text-sm"
    >
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <IconButton
          label={uiText(listOpen ? 'Hide changed files' : 'Show changed files')}
          className="size-7"
          aria-pressed={listOpen}
          aria-controls={listOpen ? listId : undefined}
          disabled={!order.length}
          onClick={() => setListOpen((open) => !open)}
        >
          <FolderTree size={14} />
        </IconButton>
        <span className="px-1 text-xs tabular-nums text-muted-foreground">
          {files
            ? uiText(order.length === 1 ? '{value0} file' : '{value0} files', {
                value0: order.length,
              })
            : uiText('Changes')}
        </span>
        {!!order.length && !metadataOnly && (
          <FileChangeCounts additions={additions} deletions={deletions} />
        )}
        <span className="flex-1" />
        {order.length > 1 && (
          <nav aria-label={uiText('Changed file navigation')} className="flex items-center">
            <IconButton
              label={uiText('Previous file')}
              className="size-7"
              disabled={!previous}
              onClick={() => {
                if (previous) onSelect(previous)
              }}
            >
              <ChevronUp size={14} />
            </IconButton>
            <span
              aria-live="polite"
              aria-atomic="true"
              className="min-w-10 text-center text-[0.6875rem] tabular-nums text-muted-foreground"
            >
              {uiText('{value0} of {value1}', { value0: index + 1, value1: order.length })}
            </span>
            <IconButton
              label={uiText('Next file')}
              className="size-7"
              disabled={!next}
              onClick={() => {
                if (next) onSelect(next)
              }}
            >
              <ChevronDown size={14} />
            </IconButton>
          </nav>
        )}
        <IconButton
          label={uiText('Refresh changes')}
          className="size-7"
          aria-busy={loading}
          disabled={!connected || loading}
          onClick={() => setAttempt((value) => value + 1)}
        >
          <RefreshCw size={14} className={cn(loading && 'motion-safe:animate-spin')} />
        </IconButton>
      </div>
      {!connected && (
        <p role="status" className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
          {uiText('Reconnect to refresh checkout changes.')}
        </p>
      )}
      {error && (
        <p role="alert" className="shrink-0 border-b px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {listOpen && order.length > 0 && (
        <nav
          id={listId}
          aria-label={uiText('Changed files')}
          className="max-h-[40%] shrink-0 overflow-auto overscroll-contain border-b p-1"
        >
          <FileBrowserTree files={entries} selected={path} onSelect={onSelect} />
        </nav>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {metadataOnly && file?.preview ? (
          <SavedFilePreview file={file} working workspaceCheckout={{ repositoryId, terminalId }} />
        ) : file?.preview ? (
          <p className="p-4 text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{file.path}</span>
            <br />
            {uiText('{value0}. No text diff to show.', { value0: filePreviewLabel(file) })}
          </p>
        ) : file ? (
          <CheckpointDiff file={file} />
        ) : (
          connected &&
          !error && (
            <p role="status" className="p-4 text-xs text-muted-foreground">
              {uiText(files ? 'No working tree changes.' : 'Loading changes…')}
            </p>
          )
        )}
      </div>
    </section>
  )
}
