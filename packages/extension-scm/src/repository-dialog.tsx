import { useId, useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { DirectoryPicker } from './directory-picker'
import { GithubRepositoryPicker } from './github-repository-picker'
import { ForgeRepositoryFields } from './forge-repository'
import {
  useWorkspace,
  useStudioHost,
  repositorySchema,
  addRepositorySchema,
  clientScopeKey,
} from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
} from '@dovo/studio-ui'
function RepositoryDialogContent({
  onClose,
  projectLabels = false,
}: {
  onClose: () => void
  projectLabels?: boolean
}) {
  const { setWorkspace, connection, connected, request } = useWorkspace()
  const { pickDirectory } = useStudioHost()
  const [source, setSource] = useState<'local' | 'github' | 'forge'>('local')
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [repository, setRepository] = useState('')
  const [directory, setDirectory] = useState('')
  const [forge, setForge] = useState({ connectionId: '', repository: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [picker, setPicker] = useState<'directory' | 'github' | null>(null)
  const running = useRef(false)
  const pathId = useId()
  const act = async (work: () => Promise<void>) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !running.current) {
          if (picker) setPicker(null)
          else onClose()
        }
      }}
    >
      <DialogContent
        className={
          picker === 'directory'
            ? 'flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-xl flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:rounded-2xl [&>button:last-child]:hidden'
            : 'max-h-[calc(100dvh-2rem)] overflow-y-auto'
        }
      >
        <DialogHeader className={picker === 'directory' ? 'sr-only' : undefined}>
          <DialogTitle>
            {picker === 'directory'
              ? 'Choose folder'
              : projectLabels
                ? 'Add project'
                : 'Add repository'}
          </DialogTitle>
          <DialogDescription>
            Open an existing checkout or clone a repository. Paths refer to the connected runtime
            host.
          </DialogDescription>
        </DialogHeader>
        {picker === 'directory' ? (
          <DirectoryPicker
            key={clientScopeKey(connection)}
            initialPath={source === 'local' ? path : directory}
            onClose={() => setPicker(null)}
            onSelect={(selected) => {
              ;(source === 'local' ? setPath : setDirectory)(selected)
              if (source === 'local' && !name.trim())
                setName(selected.split(/[\\/]/).filter(Boolean).at(-1) ?? '')
              setPicker(null)
            }}
          />
        ) : picker === 'github' ? (
          <GithubRepositoryPicker
            key={clientScopeKey(connection)}
            onClose={() => setPicker(null)}
            onSelect={(selected) => {
              setRepository(selected.fullName)
              if (!name.trim()) setName(selected.name)
              setPicker(null)
            }}
          />
        ) : (
          <form
            className="grid gap-4"
            aria-busy={busy}
            onSubmit={(e) => {
              e.preventDefault()
              void act(async () => {
                const input =
                  source === 'local'
                    ? { source, name, path }
                    : source === 'forge'
                      ? { source, name, directory, forge }
                      : { source, name, repository, directory }
                const parsed = addRepositorySchema.safeParse(input)
                if (!parsed.success)
                  throw new Error(parsed.error.issues[0]?.message ?? 'Invalid repository')
                if (connection) {
                  await request('/api/scm/repositories/add', input, repositorySchema)
                } else if (parsed.data.source === 'local') {
                  const draft = repositorySchema.parse({
                    id: crypto.randomUUID(),
                    name: parsed.data.name,
                    path: parsed.data.path,
                    branch: '',
                  })
                  setWorkspace((w) => ({
                    ...w,
                    repositories: w.repositories.some((repo) => repo.path === draft.path)
                      ? w.repositories
                      : [...w.repositories, draft],
                  }))
                } else {
                  throw new Error('Connect to a runtime before cloning a repository')
                }
                onClose()
              })
            }}
          >
            <fieldset disabled={busy} className="grid gap-4">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Repository source">
                <Button
                  type="button"
                  variant={source === 'local' ? 'default' : 'outline'}
                  aria-pressed={source === 'local'}
                  onClick={() => {
                    setSource('local')
                    setError('')
                  }}
                >
                  Local path
                </Button>
                <Button
                  type="button"
                  variant={source === 'github' ? 'default' : 'outline'}
                  aria-pressed={source === 'github'}
                  onClick={() => {
                    setSource('github')
                    setError('')
                  }}
                >
                  GitHub
                </Button>
                <Button
                  type="button"
                  variant={source === 'forge' ? 'default' : 'outline'}
                  aria-pressed={source === 'forge'}
                  onClick={() => {
                    setSource('forge')
                    setError('')
                  }}
                >
                  Connected provider
                </Button>
              </div>
              <FormField label="Name">
                <Input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-project"
                />
              </FormField>
              {source === 'github' && (
                <>
                  <FormField label="GitHub repository">
                    <Input
                      required
                      value={repository}
                      onChange={(e) => setRepository(e.target.value)}
                      placeholder="owner/repo or https://github.com/owner/repo"
                    />
                  </FormField>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!connected}
                    onClick={() => setPicker('github')}
                  >
                    Choose from GitHub…
                  </Button>
                </>
              )}
              {source === 'forge' && (
                <ForgeRepositoryFields
                  value={forge}
                  onChange={setForge}
                  disabled={busy}
                  onSelect={(repo) => {
                    if (!name.trim()) setName(repo.name)
                  }}
                />
              )}
              <div className="grid gap-2">
                <label htmlFor={pathId} className="text-xs font-medium text-muted-foreground">
                  {source === 'local' ? 'Local path' : 'Clone parent folder'}
                </label>
                <div className="flex min-w-0 items-center gap-2">
                  <Input
                    id={pathId}
                    required
                    className="min-w-0 flex-1"
                    value={source === 'local' ? path : directory}
                    onChange={(e) =>
                      source === 'local' ? setPath(e.target.value) : setDirectory(e.target.value)
                    }
                    placeholder={source === 'local' ? '~/Code/my-project' : '~/Code'}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    aria-label="Browse runtime folders…"
                    disabled={!connected}
                    onClick={() => setPicker('directory')}
                  >
                    <FolderOpen className="size-4" />
                    Browse
                  </Button>
                </div>
              </div>
              {pickDirectory && connection && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto justify-start justify-self-start px-0 text-xs text-muted-foreground"
                  disabled={!connected}
                  onClick={() =>
                    void act(async () => {
                      const selected = await pickDirectory(connection.address)
                      if (selected !== null) {
                        ;(source === 'local' ? setPath : setDirectory)(selected)
                        if (source === 'local' && !name.trim())
                          setName(selected.split(/[\\/]/).filter(Boolean).at(-1) ?? '')
                      }
                    })
                  }
                >
                  Use this computer’s system dialog…
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                {source !== 'local'
                  ? 'Clones into a new repository folder inside this parent folder, then adds it as a project on the runtime.'
                  : !connection
                    ? 'Offline paths are saved as unverified drafts.'
                    : 'The runtime verifies the checkout and detects its current branch.'}
              </p>
              {source !== 'local' && !connected && (
                <p className="text-xs text-muted-foreground">
                  Connect to a runtime to clone a repository.
                </p>
              )}
              <Button
                type="submit"
                disabled={
                  busy ||
                  ((source !== 'local' || !!connection) && !connected) ||
                  (source === 'forge' && (!forge.connectionId || !forge.repository.trim()))
                }
              >
                {busy
                  ? 'Working…'
                  : source !== 'local'
                    ? projectLabels
                      ? 'Clone and add project'
                      : 'Clone and add repository'
                    : projectLabels
                      ? 'Add project'
                      : 'Add repository'}
              </Button>
            </fieldset>
            {error && (
              <p role="alert" className="text-sm text-destructive break-words">
                {error}
              </p>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function RepositoryDialog(props: { onClose: () => void; projectLabels?: boolean }) {
  const { connection } = useWorkspace()
  return <RepositoryDialogContent key={clientScopeKey(connection)} {...props} />
}
