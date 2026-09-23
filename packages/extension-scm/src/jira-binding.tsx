import { useApplicationState } from '@dovo/studio-core/state'
import { decode } from '@dovo/protocol'
import { useEffect, useRef } from 'react'
import {
  jiraBindingSchema,
  jiraProjectsSchema,
  responses,
  useWorkspace,
  type JiraSource,
  jiraSourceSchema,
  useRuntimeSources,
} from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  FormField,
  Input,
  ChoicePicker,
} from '@dovo/studio-ui'
export function JiraSourcesDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved?: () => void
}) {
  const { workspace, activeRuntimeId, switchRuntime, refreshRuntime } = useWorkspace()
  const runtimes = useRuntimeSources()
  const [selected, setSelected] = useApplicationState<
    | {
        runtimeId: string
        source?: JiraSource
      }
    | undefined
  >(undefined)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const pending = useRef(false)
  const choose = async (runtimeId: string, source?: JiraSource) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      if (runtimeId !== activeRuntimeId) await switchRuntime(runtimeId)
      setSelected({
        runtimeId,
        source,
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {selected ? (selected.source ? 'Manage Jira source' : 'Connect Jira') : 'Issue sources'}
          </DialogTitle>
          <DialogDescription>
            Jira issues live independently of your code. Link individual issues to a Dovo project
            later.
          </DialogDescription>
        </DialogHeader>
        {selected && activeRuntimeId === selected.runtimeId ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={busy}
              onClick={() => setSelected(undefined)}
            >
              ← All issue sources
            </Button>
            <JiraForm
              key={JSON.stringify(selected)}
              initial={selected.source}
              busy={busy}
              setBusy={setBusy}
              onDone={async () => {
                const owner = runtimes.find((runtime) => runtime.profile.id === selected.runtimeId)
                if (owner) await refreshRuntime(owner.profile)
                setSelected(undefined)
                onSaved?.()
              }}
            />
          </>
        ) : (
          <div className="space-y-4">
            {runtimes.map((runtime) => {
              const sources =
                (runtime.profile.id === activeRuntimeId ? workspace : runtime.snapshot?.workspace)
                  ?.jiraSources ?? []
              return (
                <section key={runtime.profile.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">
                      {runtime.name}
                      {!runtime.connected && (
                        <span className="ml-2 text-xs text-muted-foreground">Offline</span>
                      )}
                    </h3>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !runtime.connected}
                      onClick={() => void choose(runtime.profile.id)}
                    >
                      Connect Jira
                    </Button>
                  </div>
                  {sources.map((source) => (
                    <Button
                      key={source.id}
                      variant="ghost"
                      className="h-auto w-full justify-start py-3 text-left"
                      disabled={busy || !runtime.connected}
                      onClick={() => void choose(runtime.profile.id, source)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{source.name || source.project}</span>
                        <span className="block truncate text-xs font-normal text-muted-foreground">
                          {new URL(source.site).hostname} · {source.project}
                        </span>
                      </span>
                    </Button>
                  ))}
                  {!sources.length && (
                    <p className="text-xs text-muted-foreground">No Jira sources connected.</p>
                  )}
                </section>
              )
            })}
            {!runtimes.length && (
              <p className="text-sm text-muted-foreground">
                Connect a computer in Settings to use its signed-in Jira account.
              </p>
            )}
            <p className="border-t pt-3 text-xs text-muted-foreground">
              Code-host issues are included automatically for your projects. Connecting Jira keeps
              those issue trackers available.
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
function JiraForm({
  initial,
  onDone,
  busy,
  setBusy,
}: {
  initial?: JiraSource
  onDone: () => void | Promise<void>
  busy: boolean
  setBusy: (value: boolean) => void
}) {
  const { request, connected } = useWorkspace()
  const [site, setSite] = useApplicationState(initial?.site ?? ''),
    [project, setProject] = useApplicationState(initial?.project ?? '')
  const [name, setName] = useApplicationState(initial?.name ?? '')
  const [error, setError] = useApplicationState('')
  const [discovery, setDiscovery] = useApplicationState<
    | {
        site: string
        projects: Array<{
          key: string
          name: string
        }>
        truncated: boolean
      }
    | undefined
  >(undefined)
  const [discoveryError, setDiscoveryError] = useApplicationState('')
  const [manualProject, setManualProject] = useApplicationState(false)
  const [loadingProjects, setLoadingProjects] = useApplicationState(false)
  const [revision, retry] = useApplicationState(0)
  useEffect(() => {
    if (!connected) return
    let current = true
    setLoadingProjects(true)
    setDiscoveryError('')
    void request('/api/scm/jira/projects/read', {}, jiraProjectsSchema)
      .then((value) => {
        if (!current) return
        setDiscovery(value)
        setSite((site) => site || value.site)
      })
      .catch((error) => {
        if (current) setDiscoveryError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (current) setLoadingProjects(false)
      })
    return () => {
      current = false
    }
  }, [connected, request, revision])
  const pending = useRef(false)
  const save = async (remove = false) => {
    if (pending.current || !connected) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      if (remove && initial) {
        await request(
          '/api/scm/jira/sources/remove',
          {
            sourceId: initial.id,
          },
          responses.ok,
        )
      } else {
        await request(
          '/api/scm/jira/sources/save',
          {
            source: {
              ...decode(jiraBindingSchema, {
                site: site.trim(),
                project: project.trim().toUpperCase(),
              }),
              id: initial?.id,
              name: name.trim() || discovery?.projects.find((item) => item.key === project)?.name,
            },
          },
          jiraSourceSchema,
        )
      }
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="rounded-lg border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
        Uses the signed-in Atlassian CLI account on this computer. To sign in there, run{' '}
        <code className="select-all text-foreground">acli jira auth login</code>.
        {initial && (
          <p className="mt-2">
            Removing this source hides its issues from Dovo. The issues in Jira stay unchanged.
          </p>
        )}
      </div>
      {!connected && (
        <p role="status" className="text-sm text-muted-foreground">
          This computer is offline. Connect before changing its issue source.
        </p>
      )}
      {loadingProjects && (
        <p role="status" className="text-xs text-muted-foreground">
          Finding projects in your signed-in account…
        </p>
      )}
      {discoveryError && (
        <div className="space-y-2 text-xs">
          <p role="alert" className="break-words text-destructive">
            {discoveryError}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!connected || loadingProjects || busy}
            onClick={() => retry((value) => value + 1)}
          >
            Retry account
          </Button>
        </div>
      )}
      <fieldset className="grid gap-4" disabled={busy || !connected}>
        <FormField label="Source name (optional)">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Team backlog"
            maxLength={200}
          />
        </FormField>
        <FormField label="Jira Cloud site">
          <Input
            disabled={!!initial}
            type="url"
            required
            placeholder="https://team.atlassian.net"
            value={site}
            onChange={(e) => setSite(e.target.value)}
          />
        </FormField>
        {!manualProject &&
        !!discovery?.projects.length &&
        site.replace(/\/$/, '') === discovery.site.replace(/\/$/, '') ? (
          <FormField label="Jira project">
            <ChoicePicker
              disabled={!!initial}
              aria-label="Jira project"
              value={project}
              onValueChange={setProject}
            >
              <option value="">Choose a project…</option>
              {project && !discovery.projects.some((item) => item.key === project) && (
                <option value={project}>{project}</option>
              )}
              {discovery.projects.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.name} · {item.key}
                </option>
              ))}
            </ChoicePicker>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start px-0 text-xs text-muted-foreground"
              onClick={() => setManualProject(true)}
            >
              Enter a project key instead
            </Button>
            {discovery.truncated && (
              <p className="text-xs text-muted-foreground">
                Showing available projects. Enter a key if yours is not listed.
              </p>
            )}
          </FormField>
        ) : (
          <FormField label="Jira project key">
            <Input
              required
              disabled={!!initial}
              value={project}
              onChange={(e) => setProject(e.target.value.toUpperCase())}
              placeholder="TEAM"
            />
          </FormField>
        )}
        <div className="flex justify-end gap-2">
          {initial && (
            <Button variant="outline" type="button" onClick={() => void save(true)}>
              Remove source
            </Button>
          )}
          <Button type="submit" disabled={!site.trim() || !project.trim()}>
            {busy ? 'Checking connection…' : initial ? 'Save connection' : 'Connect Jira'}
          </Button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
