import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import {
  artifactLibrarySchema,
  type ArtifactLibraryEntry,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useWorkspace, WorkspaceScope } from '@dovo/studio-core'
import { Button, Input } from '@dovo/studio-ui'
import { ArtifactCard } from './chat/artifacts'

type Entry = { profile: RuntimeProfile; artifact: ArtifactLibraryEntry }
export default function ArtifactsView() {
  const { runtimes, readRuntime } = useWorkspace()
  const [loaded, setLoaded] = useState<{ identity: string; entries: Entry[]; errors: string[] }>()
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [state, setState] = useState('all')
  const [reload, setReload] = useState(0)
  const sources = useMemo(
    () => runtimes.filter((runtime) => runtime.snapshot?.artifactsEnabled),
    [runtimes],
  )
  // Snapshot text updates must not refetch every artifact list while an agent is running.
  const identity = JSON.stringify(
    sources.map((runtime) => [
      runtime.profile.id,
      runtime.profile.name,
      runtime.profile.connection.address,
      runtime.profile.connection.token,
      runtime.connected,
    ]),
  )
  const load = useEffectEvent(() =>
    Promise.allSettled(
      sources.map(async (runtime) => {
        if (!runtime.connected) throw new Error(`${runtime.profile.name}: offline`)
        const result = await readRuntime(
          runtime.profile,
          '/api/artifacts/library',
          {},
          artifactLibrarySchema,
        )
        return result.artifacts.map((artifact): Entry => ({ profile: runtime.profile, artifact }))
      }),
    ),
  )
  useEffect(() => {
    let disposed = false
    setLoading(true)
    void load().then((results) => {
      if (disposed) return
      setLoaded({
        identity,
        entries: results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
        errors: results.flatMap((result) =>
          result.status === 'rejected' ? [String(result.reason)] : [],
        ),
      })
      setLoading(false)
    })
    return () => {
      disposed = true
    }
  }, [identity, reload])
  const entries = loaded?.identity === identity ? loaded.entries : []
  const errors = loaded?.identity === identity ? loaded.errors : []
  const query = search.trim().toLowerCase()
  const visible = entries.filter(
    ({ profile, artifact }) =>
      (state === 'all' || artifact.threadState === state) &&
      `${artifact.title} ${artifact.threadTitle} ${profile.name} ${artifact.format}`
        .toLowerCase()
        .includes(query),
  )
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="All artifacts">
      <header className="flex flex-wrap items-center gap-3 border-b p-5">
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Artifacts</h1>
          <p className="text-sm text-muted-foreground">
            Documents and previews across threads and enabled computers.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setReload((value) => value + 1)}
          disabled={loading}
        >
          Refresh
        </Button>
      </header>
      <div className="flex flex-wrap gap-3 p-5">
        <Input
          aria-label="Search artifacts"
          placeholder="Search artifacts, threads or computers…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-md"
        />
        <select
          aria-label="Artifact thread state"
          className="rounded border bg-background px-3"
          value={state}
          onChange={(event) => setState(event.target.value)}
        >
          <option value="all">All threads</option>
          <option value="active">Active</option>
          <option value="settled">Settled</option>
          <option value="archived">Archived</option>
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
        {errors.map((error, index) => (
          <p key={index} role="alert" className="mb-3 text-sm text-destructive">
            {error}
          </p>
        ))}
        {loading && <p className="text-sm text-muted-foreground">Loading artifacts…</p>}
        {!loading && !visible.length && (
          <p className="text-sm text-muted-foreground">
            {sources.length
              ? 'No artifacts match this view.'
              : 'Enable Dovo Artifacts in a computer’s settings to create and browse artifacts.'}
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map(({ profile, artifact }) => (
            <WorkspaceScope key={`${profile.id}:${artifact.id}`} profile={profile}>
              <article>
                <ArtifactCard reference={artifact} />
                <p className="text-xs text-muted-foreground">
                  {profile.name} · {artifact.threadTitle} · {artifact.threadState}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {artifact.deleteAt
                    ? `Scheduled deletion: ${new Date(artifact.deleteAt).toLocaleString()}`
                    : 'No deletion scheduled'}
                </p>
              </article>
            </WorkspaceScope>
          ))}
        </div>
      </div>
    </section>
  )
}
