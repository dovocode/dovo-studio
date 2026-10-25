import { useEffect, useState } from 'react'
import { View } from 'react-native'
import {
  usageHubsSchema,
  runtimeComputerName,
  type UsageHub,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import {
  SettingsAction as Action,
  SettingsChoice as Choice,
  SettingsField as Field,
} from './settings-controls'
import { Text } from '../ui/content/text'
import { useSettingsTheme } from './settings-theme'
export function UsageHubs({ computer, onSaved }: { computer: string; onSaved: () => void }) {
  const { overviews } = useRuntime()
  const { styles } = useSettingsTheme()
  const [selected, setSelected] = useState(''),
    [open, setOpen] = useState(false)
  const hosts = overviews.filter((entry) => computer === 'all' || computer === entry.profile.id)
  const host = hosts.find((entry) => entry.profile.id === selected) ?? hosts[0]
  return (
    <View style={{ gap: 12 }}>
      <Action
        label={open ? 'Hide usage hubs' : 'Manage usage hubs'}
        secondary
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <Text style={styles.muted}>
            Connect CLIProxyAPI to include its Codex and Claude accounts. The management key stays
            on the selected computer. This does not change agent routing.
          </Text>
          {hosts.length > 1 && (
            <Choice
              label="Hub computer"
              value={host?.profile.id ?? ''}
              items={hosts.map((entry) => ({
                id: entry.profile.id,
                name: runtimeComputerName(entry) + (entry.connected ? '' : ' · Offline'),
              }))}
              onChange={setSelected}
            />
          )}
          {host?.connected ? (
            <HubForm
              key={JSON.stringify([host.profile.id, host.profile.connection])}
              profile={host.profile}
              onSaved={onSaved}
            />
          ) : (
            <Text style={styles.muted}>Connect this computer to manage its hubs.</Text>
          )}
        </>
      )}
    </View>
  )
}
function HubForm({ profile, onSaved }: { profile: RuntimeProfile; onSaved: () => void }) {
  const { readRuntime } = useRuntime()
  const { styles } = useSettingsTheme()
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
    <View style={{ gap: 12 }}>
      {!!error && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {error}
        </Text>
      )}
      {hubs.map((hub) => (
        <View key={hub.id} style={[styles.card, { gap: 8 }]}>
          <Text style={styles.text}>
            {hub.label}
            {hub.enabled ? '' : ' · Disabled'}
          </Text>
          <Text style={styles.muted}>{hub.url}</Text>
          {!!hub.error && <Text style={styles.muted}>{hub.error}</Text>}
          <Action
            label={`Edit ${hub.label}`}
            secondary
            disabled={busy}
            onPress={() => {
              setDraft({
                id: hub.id,
                label: hub.label,
                url: hub.url,
                managementKey: '',
                enabled: hub.enabled,
              })
              setConfirm('')
            }}
          />
          <Action
            label={`Remove ${hub.label}`}
            secondary
            disabled={busy}
            onPress={() => setConfirm(hub.id)}
          />
          {confirm === hub.id && (
            <>
              <Text style={styles.muted}>
                Remove this hub from the dashboard? Its accounts and agent routing stay unchanged.
              </Text>
              <Action label="Confirm removal" disabled={busy} onPress={() => void write(hub.id)} />
              <Action label="Cancel" secondary onPress={() => setConfirm('')} />
            </>
          )}
        </View>
      ))}
      <Text style={styles.title}>{draft.id ? 'Edit hub' : 'Add a hub'}</Text>
      <Field
        editable={!busy}
        label="Hub name"
        maxLength={100}
        value={draft.label}
        onChangeText={(label) => setDraft({ ...draft, label })}
      />
      <Field
        editable={!busy}
        label="Hub URL"
        placeholder="http://hub:8317"
        autoCapitalize="none"
        autoCorrect={false}
        value={draft.url}
        onChangeText={(url) => setDraft({ ...draft, url })}
      />
      <Field
        editable={!busy}
        label="Management key"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        value={draft.managementKey}
        onChangeText={(managementKey) => setDraft({ ...draft, managementKey })}
      />
      {!!draft.id && (
        <Text style={styles.muted}>
          Leave the key blank to keep it. A changed URL requires its own key.
        </Text>
      )}
      <Choice
        label="Include in dashboard"
        disabled={busy}
        value={draft.enabled ? 'yes' : 'no'}
        items={[
          { id: 'yes', name: 'Enabled' },
          { id: 'no', name: 'Disabled' },
        ]}
        onChange={(value) => setDraft({ ...draft, enabled: value === 'yes' })}
      />
      <Action
        label={busy ? 'Saving…' : 'Save hub'}
        disabled={
          busy || !draft.label.trim() || !draft.url.trim() || (!draft.id && !draft.managementKey)
        }
        onPress={() => void write()}
      />
      {!!draft.id && (
        <Action
          label="Cancel edit"
          disabled={busy}
          secondary
          onPress={() => setDraft({ id: '', label: '', url: '', managementKey: '', enabled: true })}
        />
      )}
    </View>
  )
}
