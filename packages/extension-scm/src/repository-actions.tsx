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
  const act = (fn: () => Promise<void>) => {
    setBusy(true)
    setStatus('')
    void fn()
      .catch((error) => setStatus(String(error)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="mt-4 space-y-3">
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
        className="flex gap-2"
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
      </form>
      {status && (
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  )
}
