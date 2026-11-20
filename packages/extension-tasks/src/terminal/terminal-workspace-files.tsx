import { useEffect, useState } from 'react'
import { responses, useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { ProjectDirectoryTree } from '../detail/project-directory-tree'

const noChanges = new Map()

export function TerminalWorkspaceFiles({ terminalId }: { terminalId: string }) {
  const { connected, request } = useWorkspace()
  const [path, setPath] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [file, setFile] = useState<{ path: string; contents: string; truncated?: boolean }>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!connected || !path) return
    let current = true
    setError('')
    void request(
      '/api/terminals/workspace/read',
      { id: terminalId, path },
      responses.projectFile,
    ).then(
      (result) => {
        if (current) setFile(result)
      },
      (cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => {
      current = false
    }
  }, [connected, path, refresh, request, terminalId])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1">
        <span className="truncate text-xs" title={path}>
          {path}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!connected}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh
        </Button>
      </div>
      {!connected && (
        <p role="status" className="p-2 text-xs text-muted-foreground">
          Reconnect to browse the terminal checkout.
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <ProjectDirectoryTree
            terminalId={terminalId}
            active
            revision={refresh}
            selected={path}
            onSelect={setPath}
            changed={noChanges}
          />
        </div>
        {path && (
          <div className="min-h-0 flex-[2] overflow-auto border-t p-2 text-xs">
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            {file?.path === path ? (
              <>
                {file.truncated && (
                  <p className="text-muted-foreground">Showing the start of this file.</p>
                )}
                <pre className="whitespace-pre-wrap break-words">{file.contents}</pre>
              </>
            ) : (
              connected && !error && <p role="status">Loading file…</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
