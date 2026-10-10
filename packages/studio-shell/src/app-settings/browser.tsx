import { runtimeComputerName } from '@dovo/protocol'
import { randomUUID } from '@dovo/protocol'
import { useState } from 'react'
import {
  useAppPreferences,
  updateAppPreferences,
  useRemoteBrowserProfiles,
  useWorkspace,
  useStudioHost,
  type RuntimeProfile,
} from '@dovo/studio-core'
import type { BrowserProfile } from '@dovo/protocol'
import { Button, Input, ChoicePicker } from '@dovo/studio-ui'
import { SettingsPage, SettingsGroup, SettingRow } from './layout'
import { SettingsSelect } from './settings-select'
function ProfileName({
  profile,
  disabled,
  onSave,
  onRemove,
}: {
  profile: BrowserProfile
  disabled: boolean
  onSave: (name: string) => void
  onRemove: () => void
}) {
  const [name, setName] = useState(profile.name)
  return (
    <form
      aria-label={`Browser profile ${profile.name}`}
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(name.trim())
      }}
    >
      <Input
        className="min-w-0 flex-1 basis-36"
        aria-label={`Name for ${profile.name}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={100}
        disabled={disabled}
      />
      <Button
        title={`Save name for ${profile.name}`}
        size="sm"
        type="submit"
        disabled={disabled || !name.trim() || name.trim() === profile.name}
      >
        Save
      </Button>
      {profile.id !== 'default' && (
        <Button
          title={`Remove ${profile.name}`}
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onRemove}
        >
          Remove
        </Button>
      )}
    </form>
  )
}
function Profiles({
  profiles,
  save,
  disabled = false,
}: {
  profiles: BrowserProfile[]
  save: (profiles: BrowserProfile[]) => void | Promise<void>
  disabled?: boolean
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const update = async (next: BrowserProfile[], added = false) => {
    if (busy || disabled) return
    setBusy(true)
    setError('')
    try {
      await save(next)
      if (added) setName('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3" aria-busy={busy}>
      {!profiles.length && (
        <p className="text-xs text-muted-foreground">
          No profiles yet. Add one to keep website logins separate.
        </p>
      )}
      {profiles.map((profile) => (
        <ProfileName
          key={`${profile.id}:${profile.name}`}
          profile={profile}
          disabled={disabled || busy}
          onSave={(name) =>
            void update(profiles.map((item) => (item.id === profile.id ? { ...item, name } : item)))
          }
          onRemove={() => {
            if (
              window.confirm(
                'Remove this profile from the picker? Its saved website data will remain on this computer.',
              )
            )
              void update(profiles.filter((item) => item.id !== profile.id))
          }}
        />
      ))}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim()) void update([...profiles, { id: randomUUID(), name: name.trim() }], true)
        }}
      >
        <Input
          className="min-w-0 flex-1 basis-36"
          aria-label="New profile name"
          placeholder="Work, Personal…"
          value={name}
          maxLength={100}
          disabled={disabled || busy}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={disabled || busy || !name.trim()}>
          Add profile
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Removing a profile from this list keeps its saved website data.
      </p>
      {busy && (
        <p role="status" className="text-xs text-muted-foreground">
          Saving profiles…
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
function RemoteProfiles({
  profile,
  computerName,
}: {
  profile: RuntimeProfile
  computerName: string
}) {
  const catalog = useRemoteBrowserProfiles(profile)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Profiles and saved logins stay on {computerName}.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={!catalog.connected || catalog.loading}
          onClick={() => void catalog.refresh()}
        >
          {catalog.loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {!catalog.connected && (
        <p className="text-xs text-muted-foreground">
          Connect to this computer to manage its profiles.
        </p>
      )}
      {catalog.error && (
        <p role="alert" className="text-xs text-destructive">
          {catalog.error}
        </p>
      )}
      {catalog.profiles ? (
        <Profiles profiles={catalog.profiles} save={catalog.save} disabled={!catalog.connected} />
      ) : (
        catalog.connected &&
        !catalog.error && (
          <p role="status" className="text-xs text-muted-foreground">
            Loading profiles…
          </p>
        )
      )}
    </div>
  )
}
export default function BrowserSettings() {
  const preferences = useAppPreferences()
  const { browser } = useStudioHost()
  const { runtimes, activeRuntimeId } = useWorkspace()
  const [runtimeId, setRuntimeId] = useState(activeRuntimeId ?? '')
  const runtime = runtimes.find((entry) => entry.profile.id === runtimeId) ?? runtimes[0]
  return (
    <SettingsPage
      title="Browser"
      description="Keep website logins separate with browser profiles. Choose a profile for each tab."
    >
      <SettingsGroup title="Browser previews">
        <SettingRow
          label="Default viewport"
          description="Saved on this device. You can change the viewport in each preview."
        >
          <SettingsSelect
            label="Default viewport"
            value={preferences.browserViewport}
            options={[
              ['fill', 'Fit window'],
              ['phone', 'Phone'],
              ['tablet', 'Tablet'],
              ['desktop', 'Desktop'],
            ]}
            onChange={(browserViewport) => updateAppPreferences({ browserViewport })}
          />
        </SettingRow>
      </SettingsGroup>
      {browser && (
        <SettingsGroup
          title="Local browser profiles"
          description="Used by regular tabs on this desktop. Saved automatically on this device."
        >
          <div className="space-y-3 p-4">
            <Profiles
              profiles={preferences.browserProfiles}
              save={(browserProfiles) => updateAppPreferences({ browserProfiles })}
            />
          </div>
        </SettingsGroup>
      )}
      <SettingsGroup
        title="Remote browser profiles"
        description="Used by remote tabs. Profile names and saved logins stay on the selected computer."
      >
        <div className="space-y-3 p-4">
          {runtime ? (
            <>
              <label className="block space-y-2">
                <span className="text-xs font-medium">Computer</span>
                <ChoicePicker
                  aria-label="Computer for browser profiles"
                  value={runtime.profile.id}
                  onValueChange={setRuntimeId}
                >
                  {runtimes.map((entry) => (
                    <option key={entry.profile.id} value={entry.profile.id}>
                      {runtimeComputerName(entry)}
                      {entry.connected ? '' : ' · Offline'}
                    </option>
                  ))}
                </ChoicePicker>
              </label>
              <RemoteProfiles
                key={runtime.profile.id}
                profile={runtime.profile}
                computerName={runtimeComputerName(runtime)}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Connect a computer to manage its browser profiles.
            </p>
          )}
        </div>
      </SettingsGroup>
    </SettingsPage>
  )
}
