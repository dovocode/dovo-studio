import { useEffect, useRef, useState } from 'react'
import { Effect } from 'effect'
import { responses, useWorkspace } from '@dovo/studio-core'
import type { ChangedFile, ProjectDirectory } from '@dovo/protocol'
import { Button, FileChangeCounts, FileTypeIcon } from '@dovo/studio-ui'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { fileStats } from '../files/presentation'

type Props = {
  taskId: string
  checkoutId?: string
  revision: number
  refresh?: number
  selected: string
  disabled?: boolean
  changed: ReadonlyMap<string, ChangedFile>
  onSelect: (path: string) => void
  active: boolean
}

type BranchProps = Props & Pick<ReturnType<typeof useWorkspace>, 'requestEffect' | 'connected'>

export function ProjectDirectoryTree(props: Props) {
  const { requestEffect, connected } = useWorkspace()
  return (
    <nav aria-label="Project folders">
      <Directory {...props} requestEffect={requestEffect} connected={connected} path="" />
    </nav>
  )
}

function Directory({ path, active, ...props }: BranchProps & { path: string; active: boolean }) {
  const { requestEffect, connected } = props
  const [result, setResult] = useState<ProjectDirectory>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const version = JSON.stringify([props.revision, props.refresh])
  const [page, setPage] = useState<{ version: string; cursor?: string }>({ version })
  const [retry, setRetry] = useState(0)
  const cursor = page.version === version ? page.cursor : undefined
  const loaded = useRef('')
  const key = JSON.stringify([version, cursor, retry])
  useEffect(() => {
    if (!connected) {
      loaded.current = ''
      return
    }
    if (!active || loaded.current === key) return
    let current = true
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void Effect.runPromise(
      requestEffect(
        '/api/tasks/files/directory',
        { id: props.taskId, checkoutId: props.checkoutId, directory: path, cursor },
        responses.projectDirectory,
      ),
      { signal: controller.signal },
    ).then(
      (value) => {
        if (!current) return
        loaded.current = key
        setResult((previous) => ({
          ...value,
          entries: cursor
            ? [
                ...new Map(
                  [...(previous?.entries ?? []), ...value.entries].map((entry) => [
                    entry.path,
                    entry,
                  ]),
                ).values(),
              ]
            : value.entries,
        }))
        setLoading(false)
      },
      (failure: unknown) => {
        if (!current) return
        setError(failure instanceof Error ? failure.message : String(failure))
        setLoading(false)
      },
    )
    return () => {
      current = false
      controller.abort()
    }
  }, [active, connected, requestEffect, props.taskId, props.checkoutId, path, cursor, key])
  return (
    <div className="space-y-0.5">
      {result?.entries.map((entry) =>
        entry.kind === 'directory' ? (
          <FolderEntry key={entry.path} {...props} path={entry.path} active={active} />
        ) : (
          <button
            key={entry.path}
            type="button"
            aria-label={entry.path}
            aria-current={props.selected === entry.path ? 'true' : undefined}
            disabled={props.disabled}
            className={`flex w-full items-center gap-2 rounded-xl border border-transparent py-1.5 pl-6 pr-2 text-left text-xs hover:bg-accent disabled:opacity-50 ${props.selected === entry.path ? 'studio-selected-surface' : ''}`}
            onClick={() => props.onSelect(entry.path)}
          >
            <FileTypeIcon path={entry.path} />
            <span className="min-w-0 flex-1 truncate">{entry.path.split('/').at(-1)}</span>
            <EntryStats path={entry.path} changed={props.changed} />
          </button>
        ),
      )}
      {!connected && !result && (
        <p className="p-2 text-xs text-muted-foreground">Reconnect to browse files.</p>
      )}
      {loading && active && connected && (
        <p role="status" className="p-2 text-xs text-muted-foreground">
          Loading folder…
        </p>
      )}
      {error && (
        <div>
          <p role="alert" className="p-2 text-xs text-destructive">
            {error}
          </p>
          <Button
            size="sm"
            variant="ghost"
            disabled={!connected}
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry folder
          </Button>
        </div>
      )}
      {result?.entries.length === 0 && !loading && !error && (
        <p className="p-2 text-xs text-muted-foreground">This folder has no visible files.</p>
      )}
      {result?.nextCursor && (
        <Button
          size="sm"
          variant="ghost"
          disabled={!connected || loading || props.disabled}
          onClick={() => setPage({ version, cursor: result.nextCursor })}
        >
          More entries
        </Button>
      )}
      {result?.truncated && !result.nextCursor && (
        <p className="p-2 text-xs text-muted-foreground">
          Some files are omitted. Search to find more files.
        </p>
      )}
    </div>
  )
}

function FolderEntry({ path, active, ...props }: BranchProps & { path: string; active: boolean }) {
  const [expanded, setExpanded] = useState(() => !!props.selected?.startsWith(`${path}/`))
  const [visited, setVisited] = useState(expanded)
  useEffect(() => {
    if (props.selected?.startsWith(`${path}/`)) {
      setExpanded(true)
      setVisited(true)
    }
  }, [props.selected, path])
  return (
    <details
      open={expanded}
      onToggle={(event) => {
        const open = event.currentTarget.open
        setExpanded(open)
        if (open) setVisited(true)
      }}
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-1.5 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
        aria-label={`Folder ${path}`}
        aria-disabled={props.disabled}
        onClick={(event) => {
          if (props.disabled) event.preventDefault()
        }}
      >
        <ChevronRight size={12} className={`shrink-0 ${expanded ? 'rotate-90' : ''}`} />
        {expanded ? (
          <FolderOpen size={14} className="shrink-0 text-muted-foreground" />
        ) : (
          <Folder size={14} className="shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{path.split('/').at(-1)}</span>
      </summary>
      <div className="ml-3 border-l border-border/50 pl-1">
        {visited && <Directory {...props} path={path} active={active && expanded} />}
      </div>
    </details>
  )
}

function EntryStats({ path, changed }: Pick<Props, 'changed'> & { path: string }) {
  const file = changed.get(path)
  return <FileChangeCounts {...(file ? fileStats(file) : undefined)} />
}
