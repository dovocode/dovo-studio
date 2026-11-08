import { useEffect, useMemo, useState } from 'react'
import { Effect } from 'effect'
import { responses, useWorkspace } from '@dovo/studio-core'
import type { ProjectContentSearch, ChangedFile } from '@dovo/protocol'
import { Button, SearchField, FileTypeIcon, FileChangeCounts } from '@dovo/studio-ui'
import { ProjectDirectoryTree } from './project-directory-tree'
import { fileStats } from '../files/presentation'

export function ProjectFileBrowser({
  taskId,
  checkoutId,
  revision,
  disabled,
  onSelect,
  selected,
  changedFiles,
}: {
  taskId: string
  checkoutId?: string
  revision: number
  disabled?: boolean
  selected: string
  changedFiles: readonly ChangedFile[]
  onSelect: (path: string, line?: number) => void
}) {
  const { requestEffect, connected, connection, activeRuntimeId } = useWorkspace()
  const changed = useMemo(
    () => new Map(changedFiles.map((file) => [file.path, file])),
    [changedFiles],
  )
  const stats = (path: string) => {
    const file = changed.get(path)
    return file ? fileStats(file) : undefined
  }
  const [mode, setMode] = useState<'files' | 'content'>('files')
  const [query, setQuery] = useState('')
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{
    identity: string
    paths?: string[]
    content?: ProjectContentSearch
    truncated?: boolean
    error?: string
  }>()
  const identity = JSON.stringify([
    activeRuntimeId,
    connection?.address,
    connection?.token,
    taskId,
    checkoutId,
    mode,
    query,
  ])
  const current = result?.identity === identity ? result : undefined
  useEffect(() => {
    if (!connected || !query) return
    let active = true
    const controller = new AbortController()
    const timeout = setTimeout(
      () => {
        const run = (): Effect.Effect<
          {
            paths?: string[]
            content?: ProjectContentSearch
            truncated?: boolean
          },
          Error
        > => {
          if (mode === 'content')
            return requestEffect(
              '/api/tasks/files/search-content',
              { id: taskId, checkoutId, query },
              responses.projectContentSearch,
            ).pipe(Effect.map((content) => ({ content })))
          return requestEffect(
            '/api/tasks/files/search-paths',
            { id: taskId, checkoutId, query },
            responses.projectFileList,
          ).pipe(Effect.map((paths) => ({ paths: paths.files, truncated: paths.truncated })))
        }
        const failed = (error: unknown) => {
          if (active)
            setResult((previous) => ({
              ...(previous?.identity === identity ? previous : {}),
              identity,
              error: error instanceof Error ? error.message : String(error),
            }))
        }
        void Effect.runPromise(
          run().pipe(
            Effect.match({
              onSuccess: (value) => {
                if (active) setResult({ identity, ...value })
              },
              onFailure: failed,
            }),
          ),
          { signal: controller.signal },
        ).catch(failed)
      },
      query ? 200 : 0,
    )
    return () => {
      active = false
      clearTimeout(timeout)
      controller.abort()
    }
  }, [requestEffect, connected, taskId, mode, query, revision, retry, identity])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'hidden') setRetry((value) => value + 1)
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [])
  return (
    <>
      <div className="space-y-2 border-b p-2">
        <div className="flex gap-1" aria-label="Project search mode">
          <Button
            size="sm"
            variant="ghost"
            className={`h-7 rounded-md border px-2 text-xs ${mode === 'files' ? 'studio-selected-surface font-medium' : 'border-transparent text-muted-foreground'}`}
            aria-pressed={mode === 'files'}
            onClick={() => setMode('files')}
          >
            Files
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={`h-7 rounded-md border px-2 text-xs ${mode === 'content' ? 'studio-selected-surface font-medium' : 'border-transparent text-muted-foreground'}`}
            aria-pressed={mode === 'content'}
            onClick={() => setMode('content')}
          >
            Code
          </Button>
        </div>
        <SearchField
          role="searchbox"
          aria-label={mode === 'content' ? 'Search project code' : 'Search project files'}
          placeholder={mode === 'content' ? 'Literal code search…' : 'Search files…'}
          value={query}
          onValueChange={(value) => {
            setQuery(value.slice(0, 256))
          }}
          clearLabel="Clear file search"
          className="text-xs"
        />
        {mode === 'content' && (
          <p className="text-[0.625rem] text-muted-foreground">
            Case-sensitive literal search · up to 200 matching lines.
          </p>
        )}
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto overscroll-contain p-1.5"
        aria-label="Project file entries"
      >
        <div hidden={!!query || mode !== 'files'}>
          <ProjectDirectoryTree
            key={JSON.stringify([
              activeRuntimeId,
              connection?.address,
              connection?.token,
              taskId,
              checkoutId,
            ])}
            taskId={taskId}
            checkoutId={checkoutId}
            revision={revision}
            refresh={retry}
            active={!query && mode === 'files'}
            selected={selected}
            disabled={disabled}
            changed={changed}
            onSelect={onSelect}
          />
        </div>
        {!query && mode === 'files' ? null : !connected ? (
          <p className="p-2 text-xs text-muted-foreground">Reconnect to browse files.</p>
        ) : mode === 'content' && !query ? (
          <p className="p-2 text-xs text-muted-foreground">
            Enter text to search this checkout’s code.
          </p>
        ) : !current ? (
          <p role="status" className="p-2 text-xs text-muted-foreground">
            {query ? 'Searching…' : 'Loading folder…'}
          </p>
        ) : (
          <>
            {current.error && (
              <div>
                <p role="alert" className="p-2 text-xs text-destructive">
                  {current.error}
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    setRetry((value) => value + 1)
                  }}
                >
                  Retry file search
                </Button>
              </div>
            )}
            {current.paths?.map((path) => (
              <button
                key={path}
                type="button"
                aria-current={selected === path ? 'true' : undefined}
                data-selected={selected === path}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-xs hover:bg-accent data-[selected=true]:bg-accent"
                disabled={disabled}
                onClick={() => onSelect(path)}
              >
                <FileTypeIcon path={path} />
                <span className="min-w-0 flex-1 break-words">{path}</span>
                <FileChangeCounts {...stats(path)} />
              </button>
            ))}
            {current.content?.matches.map((match) => (
              <button
                key={`${match.path}:${match.line}`}
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-xs hover:bg-accent"
                disabled={disabled}
                onClick={() => onSelect(match.path, match.line)}
              >
                <span className="block break-words font-medium">
                  {match.path}:{match.line}
                </span>
                <span className="block truncate font-mono text-muted-foreground">
                  {match.excerpt.slice(0, match.matchStart)}
                  <mark>{match.excerpt.slice(match.matchStart, match.matchEnd)}</mark>
                  {match.excerpt.slice(match.matchEnd)}
                </span>
              </button>
            ))}
            {(current.truncated || current.content?.truncated) && (
              <p className="p-2 text-xs text-muted-foreground">
                Some files are omitted. Narrow the search or open a smaller folder.
              </p>
            )}
            {current.paths && current.truncated === undefined && (
              <p className="p-2 text-xs text-muted-foreground">
                Listing completeness is unknown. Search covers returned files.
              </p>
            )}
            {!!current.content?.skippedFiles && (
              <p className="p-2 text-xs text-muted-foreground">
                {current.content.skippedFiles}{' '}
                {current.content.skippedFiles === 1 ? 'item' : 'items'} skipped because they changed
                or exceeded read limits.
              </p>
            )}
            {(current.paths?.length === 0 || current.content?.matches.length === 0) && (
              <p className="p-2 text-xs text-muted-foreground">
                {query
                  ? current.paths
                    ? current.truncated === false
                      ? 'No matching files.'
                      : 'No matching files in this listing.'
                    : 'No matches in the searched files.'
                  : 'No matching files.'}
              </p>
            )}
          </>
        )}
      </div>
    </>
  )
}
