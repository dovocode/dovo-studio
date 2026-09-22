import { BookMarked, Lock, Globe } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  githubRepositoryPageSchema,
  useWorkspace,
  type GithubRepositoryChoice,
  type GithubRepositoryPage,
} from '@dovo/studio-core'
import { Button, FormField, Input } from '@dovo/studio-ui'

export function GithubRepositoryPicker({
  onSelect,
  onClose,
}: {
  onSelect: (repository: GithubRepositoryChoice) => void
  onClose: () => void
}) {
  const { request, connected } = useWorkspace()
  const [load, setLoad] = useState({ page: 1 })
  const [data, setData] = useState<GithubRepositoryPage | null>(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setBusy(true)
    setError('')
    void request('/api/scm/repositories/github/read', load, githubRepositoryPageSchema)
      .then((result) => {
        if (active)
          setData((previous) => ({
            ...result,
            repositories:
              load.page === 1
                ? result.repositories
                : [
                    ...new Map(
                      [...(previous?.repositories ?? []), ...result.repositories].map((repo) => [
                        repo.fullName,
                        repo,
                      ]),
                    ).values(),
                  ],
          }))
      })
      .catch((error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [load, request])
  const repositories =
    data?.repositories.filter((repo) =>
      `${repo.fullName} ${repo.description}`.toLowerCase().includes(filter.toLowerCase().trim()),
    ) ?? []
  return (
    <section className="grid gap-3" aria-label="GitHub repository picker" aria-busy={busy}>
      <h3 className="text-sm font-medium">Choose a GitHub repository</h3>
      <p className="text-xs text-muted-foreground">
        Uses the runtime host’s GitHub login, including accessible organization repositories.
        Selecting fills the form; cloning starts only when you confirm.
      </p>
      <FormField label="Filter loaded repositories">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Repository or organization name"
        />
      </FormField>
      {error && (
        <>
          <p role="alert" className="break-words text-sm text-destructive">
            {error}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !connected}
            onClick={() => setLoad({ ...load })}
          >
            Retry
          </Button>
        </>
      )}
      <div className="grid max-h-72 gap-1 overflow-y-auto rounded-md border p-1">
        {repositories.map((repo) => (
          <Button
            key={repo.fullName}
            type="button"
            variant="ghost"
            className="h-auto flex-col items-start gap-1 whitespace-normal text-left"
            disabled={busy || !connected}
            onClick={() => onSelect(repo)}
          >
            <span className="flex w-full items-center gap-2 break-all">
              <BookMarked className="size-4 shrink-0 text-muted-foreground" />
              {repo.fullName}{' '}
              <span className="text-xs text-muted-foreground">
                {repo.private ? (
                  <Lock aria-label="Private" className="size-3" />
                ) : (
                  <Globe aria-label="Public" className="size-3" />
                )}
              </span>
            </span>
            {repo.description && (
              <span className="line-clamp-2 text-xs font-normal text-muted-foreground">
                {repo.description}
              </span>
            )}
          </Button>
        ))}
        {!busy && !error && !repositories.length && (
          <p className="p-3 text-xs text-muted-foreground">
            {data?.repositories.length
              ? 'No matches in loaded repositories. Load more or change the filter.'
              : 'No accessible repositories found.'}
          </p>
        )}
      </div>
      {busy && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading GitHub repositories…
        </p>
      )}
      {data && (
        <p className="text-xs text-muted-foreground">
          {data.repositories.length} loaded
          {data.nextPage !== null ? ' · More available' : ' · All loaded'}
        </p>
      )}
      <div className="flex justify-between gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Back
        </Button>
        {data?.nextPage != null && (
          <Button
            type="button"
            variant="outline"
            disabled={busy || !connected}
            onClick={() => {
              if (data.nextPage !== null) setLoad({ page: data.nextPage })
            }}
          >
            Load more
          </Button>
        )}
      </div>
    </section>
  )
}
