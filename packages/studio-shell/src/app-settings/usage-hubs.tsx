import { useEffect, useState } from 'react'
import {
  usageHubsSchema,
  runtimeComputerName,
  type UsageHub,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button, ChoicePicker, Input } from '@dovo/studio-ui'
export function UsageHubs({ computer, onSaved }: { computer: string; onSaved: () => void }) {
  const { runtimes } = useWorkspace()
  const [selected, setSelected] = useState('')
  const hosts = runtimes.filter((entry) => computer === 'all' || computer === entry.profile.id)
  const host = hosts.find((entry) => entry.profile.id === selected) ?? hosts[0]
  const [open, setOpen] = useState(false)
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <Button variant="outline" onClick={() => setOpen(!open)} aria-expanded={open}>
        Manage usage hubs
      </Button>
      {open && (
        <>
          <p className="text-xs text-muted-foreground">
            Connect CLIProxyAPI to include its Codex and Claude accounts. The management key stays
            on the selected computer. This does not change agent routing.
          </p>
          {hosts.length > 1 && (
            <ChoicePicker
              aria-label="Hub computer"
              value={host?.profile.id ?? ''}
              onValueChange={setSelected}
            >
              {hosts.map((entry) => (
                <option key={entry.profile.id} value={entry.profile.id}>
                  {runtimeComputerName(entry)}
                  {entry.connected ? '' : ' · Offline'}
                </option>
              ))}
            </ChoicePicker>
          )}
          {host?.connected ? (
            <HubForm
              key={JSON.stringify([host.profile.id, host.profile.connection])}
              profile={host.profile}
              onSaved={onSaved}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Connect this computer to manage its hubs.
            </p>
          )}
        </>
      )}
    </section>
  )
}
function HubForm({ profile, onSaved }: { profile: RuntimeProfile; onSaved: () => void }) {
  const { readRuntime } = useWorkspace()
  const [hubs, setHubs] = useState<UsageHub[]>([])
  const [draft, setDraft] = useState({
    id: '',
    label: '',
    url: '',
    managementKey: '',
    enabled: true,
  })
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState('')
  useEffect(() => {
    let active = true
    void readRuntime(profile, '/api/usage/hubs/read', {}, usageHubsSchema, 'POST')
      .then((value) => {
        if (active) setHubs(value)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [profile, readRuntime])
  const write = async (remove?: string) => {
    setBusy(true)
    setError('')
    try {
      const input = remove
        ? { id: remove }
        : {
            ...draft,
            id: draft.id || undefined,
            label: draft.label.trim(),
            url: draft.url.trim(),
            managementKey: draft.managementKey || undefined,
          }
      setHubs(
        await readRuntime(
          profile,
          remove ? '/api/usage/hubs/remove' : '/api/usage/hubs/write',
          input,
          usageHubsSchema,
          'POST',
        ),
      )
      if (!remove || draft.id === remove)
        setDraft({ id: '', label: '', url: '', managementKey: '', enabled: true })
      setConfirm('')
      onSaved()
    } catch {
      setError(
        'Could not save hubs. Check the name, URL and key, and that the runtime supports usage hubs.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {hubs.map((hub) => (
        <div key={hub.id} className="rounded border p-3 space-y-2 text-xs">
          <p className="font-medium break-words">
            {hub.label}
            {hub.enabled ? '' : ' · Disabled'}
          </p>
          <p className="break-all text-muted-foreground">{hub.url}</p>
          {hub.error && <p role="status">{hub.error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setDraft({
                  id: hub.id,
                  label: hub.label,
                  url: hub.url,
                  managementKey: '',
                  enabled: hub.enabled,
                })
                setConfirm('')
              }}
            >
              Edit {hub.label}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(hub.id)}>
              Remove {hub.label}
            </Button>
          </div>
          {confirm === hub.id && (
            <div role="group" aria-label={`Remove ${hub.label}?`} className="space-y-2">
              <p>
                Remove this hub from the dashboard? Its accounts and agent routing stay unchanged.
              </p>
              <Button variant="destructive" disabled={busy} onClick={() => void write(hub.id)}>
                Confirm removal
              </Button>{' '}
              <Button variant="outline" onClick={() => setConfirm('')}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      ))}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void write()
        }}
      >
        <h3 className="text-sm font-medium">{draft.id ? 'Edit hub' : 'Add a hub'}</h3>
        <label className="block text-xs">
          Hub name
          <Input
            disabled={busy}
            required
            maxLength={100}
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          />
        </label>
        <label className="block text-xs">
          Hub URL
          <Input
            disabled={busy}
            required
            type="url"
            placeholder="http://hub:8317"
            value={draft.url}
            onChange={(event) => setDraft({ ...draft, url: event.target.value })}
          />
        </label>
        <label className="block text-xs">
          Management key
          <Input
            disabled={busy}
            type="password"
            autoComplete="off"
            required={!draft.id}
            value={draft.managementKey}
            onChange={(event) => setDraft({ ...draft, managementKey: event.target.value })}
          />
        </label>
        {draft.id && (
          <p className="text-xs text-muted-foreground">
            Leave the key blank to keep it. A changed URL requires its own key.
          </p>
        )}
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            disabled={busy}
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />
          Include in dashboard
        </label>
        <Button type="submit" disabled={busy || !draft.label.trim() || !draft.url.trim()}>
          {busy ? 'Saving…' : 'Save hub'}
        </Button>
        {draft.id && (
          <Button
            type="button"
            disabled={busy}
            variant="outline"
            onClick={() =>
              setDraft({ id: '', label: '', url: '', managementKey: '', enabled: true })
            }
          >
            Cancel edit
          </Button>
        )}
      </form>
    </div>
  )
}
