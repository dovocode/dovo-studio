import { CreateGithub } from './create-github'
import { useRef } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { branchesSchema, encodeWorkTarget } from '@dovo/studio-core'
import { BranchPicker } from '@dovo/studio-ui'
import {
  responses,
  useWorkspace,
  useStudioHost,
  type Repository,
  type ChangedFile,
} from '@dovo/studio-core'
import { Button, Input } from '@dovo/studio-ui'
export function RepositoryActions({ repo, taskId }: { repo: Repository; taskId?: string }) {
  const host = useStudioHost()
  const { request, connected } = useWorkspace(),
    [checkout, setCheckout] = useApplicationState(''),
    [files, setFiles] = useApplicationState<ChangedFile[]>([]),
    [message, setMessage] = useApplicationState(''),
    [status, setStatus] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const input = {
    repositoryId: repo.id,
    ...(taskId
      ? {
          taskId,
        }
      : {}),
  }
  const pending = useRef(false)
  const act = (fn: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setStatus('')
    void fn()
      .catch((error) => setStatus(String(error)))
      .finally(() => {
        pending.current = false
        setBusy(false)
      })
  }
  return (
    <div className="mt-4 space-y-3">
      <CreateGithub path={repo.path} disabled={busy} />
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['finder', 'Open in Finder'],
            ['vscode', 'Open in VS Code'],
            ['cursor', 'Open in Cursor'],
          ] as const
        ).map(([target, label]) => (
          <Button
            key={target}
            size="sm"
            variant="ghost"
            disabled={!connected || busy}
            onClick={() =>
              act(async () => {
                await request('/api/scm/open-folder', { ...input, target }, responses.ok)
                setStatus('Opened on the runtime computer.')
              })
            }
          >
            {label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || busy}
          onClick={() =>
            act(async () => {
              await request('/api/scm/push', input, responses.ok)
              setStatus('Branch pushed.')
            })
          }
        >
          Push branch
        </Button>
      </div>
      <BranchPicker
        current={taskId ? undefined : repo.branch}
        disabled={!connected || busy}
        load={() => request('/api/scm/branches', input, branchesSchema)}
        change={async (value) => {
          const result = await request(
            '/api/scm/branch',
            {
              ...input,
              ...value,
            },
            branchesSchema,
          )
          setCheckout(result.current)
          setFiles([])
          return result
        }}
      />
      {checkout && <p className="break-all font-mono text-xs text-muted-foreground">{checkout}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || busy}
          onClick={() =>
            act(async () => {
              const inspected = await request('/api/scm/inspect', input, responses.inspected)
              setCheckout(`${inspected.path} · ${inspected.branch}`)
              const { files } = await request('/api/scm/changes', input, responses.files)
              setFiles(files)
              setStatus(
                `${files.length} text files changed (binary and files over 2 MB are omitted).`,
              )
            })
          }
        >
          Refresh Git
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || busy}
          onClick={() =>
            host.navigate({
              viewId: 'pulls',
              entityId: repo.id,
            })
          }
        >
          Pull requests
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            host.navigate({
              viewId: 'issues',
              entityId: encodeWorkTarget({
                repositoryId: repo.id,
              }),
            })
          }
        >
          Issues
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || busy || !files.length}
          onClick={() =>
            act(async () => {
              await request(
                '/api/scm/stage',
                {
                  ...input,
                  paths: files.map((file) => file.path),
                },
                responses.ok,
              )
              setStatus('Listed changes staged.')
            })
          }
        >
          Stage listed changes
        </Button>
      </div>
      {files.length > 0 && (
        <ul className="max-h-40 overflow-auto font-mono text-[11px] text-muted-foreground">
          {files.map((file) => (
            <li key={file.path}>{file.path}</li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          act(async () => {
            const result = await request(
              '/api/scm/commit',
              {
                ...input,
                message,
              },
              responses.commit,
            )
            setStatus(`Committed ${result.commit.slice(0, 8)}`)
            setMessage('')
          })
        }}
      >
        <Input
          aria-label="Commit message"
          placeholder="Commit message for staged changes"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          required
        />
        <Button size="sm" variant="outline" disabled={!connected || busy || !message.trim()}>
          Commit staged
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!connected || busy || !message.trim()}
          onClick={() =>
            act(async () => {
              const result = await request(
                '/api/scm/commit',
                { ...input, message },
                responses.commit,
              )
              setMessage('')
              setFiles([])
              try {
                await request('/api/scm/push', input, responses.ok)
                setStatus(`Committed ${result.commit.slice(0, 8)} and pushed.`)
              } catch (error) {
                setStatus(
                  `Committed ${result.commit.slice(0, 8)}, but push failed: ${String(error)}. Use Push branch to retry without committing again.`,
                )
              }
            })
          }
        >
          Commit &amp; push
        </Button>
      </form>
      {status && (
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  )
}
