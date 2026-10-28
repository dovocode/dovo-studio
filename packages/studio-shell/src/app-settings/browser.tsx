import {
  runtimeComputerName,
  browserLanguageSchema,
  decodeResult,
  normalizeBrowserLinkDomain,
  browserProfilesSchema,
} from '@dovo/protocol'
import { randomUUID } from '@dovo/protocol'
import { useCallback, useEffect, useState } from 'react'
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
const profileEmojis = [
  ['💼', 'Work'],
  ['🏠', 'Home'],
  ['👤', 'Personal'],
  ['💻', 'Development'],
  ['🧪', 'Testing'],
  ['🚀', 'Launch'],
  ['🎨', 'Design'],
  ['📚', 'Learning'],
  ['🌍', 'Travel'],
  ['🎮', 'Gaming'],
  ['💬', 'Social'],
  ['🎵', 'Music'],
  ['⭐', 'Favorite'],
  ['🌱', 'Growth'],
  ['🐱', 'Cat'],
  ['🐶', 'Dog'],
  ['🦊', 'Fox'],
  ['☕', 'Coffee'],
  ['❤️', 'Heart'],
  ['🔵', 'Blue'],
  ['🟢', 'Green'],
  ['🟣', 'Purple'],
] as const
function DefaultBrowser() {
  const { defaultBrowser } = useStudioHost()
  const [status, setStatus] = useState<import('@dovo/protocol').DefaultBrowserStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    if (!defaultBrowser) return
    try {
      setStatus(await defaultBrowser.status())
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [defaultBrowser])
  useEffect(() => {
    void refresh()
    const focus = () => void refresh()
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [refresh])
  if (!defaultBrowser) return null
  return (
    <SettingsGroup title="Default browser">
      <SettingRow
        label="Open links from other apps"
        description={
          status?.supported === false
            ? 'Install Dovo Studio to choose it as your default browser.'
            : status?.isDefault
              ? 'Dovo Studio is your default browser for HTTP and HTTPS links.'
              : 'Choose Dovo Studio as your browser in the system default-app settings.'
        }
      >
        <Button
          variant="outline"
          size="sm"
          disabled={busy || status?.supported === false || status?.isDefault}
          onClick={async () => {
            setBusy(true)
            setError('')
            try {
              await defaultBrowser.request()
              await refresh()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause))
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy
            ? 'Opening system settings…'
            : status?.isDefault
              ? 'Default browser'
              : 'Set as default browser'}
        </Button>
      </SettingRow>
      {error && (
        <p role="alert" className="px-4 pb-4 text-xs text-destructive">
          {error}
        </p>
      )}
    </SettingsGroup>
  )
}
function ProfileName({
  profile,
  disabled,
  onSave,
  onRemove,
  routing,
}: {
  profile: BrowserProfile
  disabled: boolean
  routing: boolean
  onSave: (name: string, language: string, linkDomains: string[], emoji?: string) => void
  onRemove: () => void
}) {
  const [name, setName] = useState(profile.name)
  const [emoji, setEmoji] = useState(profile.emoji ?? '')
  const [language, setLanguage] = useState(profile.language ?? 'en-US')
  const [domains, setDomains] = useState((profile.linkDomains ?? []).join(', '))
  const linkDomains = domains
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizeBrowserLinkDomain)
  const validDomains =
    linkDomains.every((value): value is string => value !== undefined) &&
    new Set(linkDomains).size === linkDomains.length
  const validLanguage = decodeResult(browserLanguageSchema, language).success
  return (
    <form
      aria-label={`Browser profile ${profile.name}`}
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (validLanguage && validDomains)
          onSave(
            name.trim(),
            Intl.getCanonicalLocales(language)[0]!,
            linkDomains,
            emoji || undefined,
          )
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Profile icon
        <ChoicePicker
          aria-label={`Emoji for ${profile.name}`}
          value={emoji}
          onValueChange={setEmoji}
          disabled={disabled}
          className="w-36"
        >
          <option value="">Initials</option>
          {emoji && !profileEmojis.some(([value]) => value === emoji) && (
            <option value={emoji}>{emoji}</option>
          )}
          {profileEmojis.map(([value, label]) => (
            <option key={value} value={value}>
              {value} {label}
            </option>
          ))}
        </ChoicePicker>
      </label>
      <Input
        className="min-w-0 flex-1 basis-36"
        aria-label={`Name for ${profile.name}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={100}
        disabled={disabled}
      />
      <label className="flex min-w-0 flex-1 basis-36 flex-col gap-1 text-xs text-muted-foreground">
        Website language
        <Input
          aria-label={`Language for ${profile.name}`}
          value={language}
          placeholder="en-US"
          maxLength={100}
          disabled={disabled}
          aria-invalid={!validLanguage}
          onChange={(event) => setLanguage(event.target.value)}
        />
      </label>
      {routing && (
        <label className="flex min-w-0 basis-full flex-col gap-1 text-xs text-muted-foreground">
          Open links in this profile
          <Input
            aria-label={`Link domains for ${profile.name}`}
            value={domains}
            disabled={disabled}
            placeholder="teams.microsoft.com, example.com/work, *.example.com"
            aria-invalid={!validDomains}
            onChange={(event) => setDomains(event.target.value)}
          />
        </label>
      )}
      <Button
        title={`Save name for ${profile.name}`}
        size="sm"
        type="submit"
        disabled={
          disabled ||
          !name.trim() ||
          !validLanguage ||
          !validDomains ||
          (name.trim() === profile.name &&
            emoji === (profile.emoji ?? '') &&
            language === (profile.language ?? 'en-US') &&
            domains === (profile.linkDomains ?? []).join(', '))
        }
      >
        Save
      </Button>
      {profile.id !== 'default' && (
        <Button
          title={`Remove ${profile.name}`}
          type="button"
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
  routing = false,
}: {
  profiles: BrowserProfile[]
  save: (profiles: BrowserProfile[]) => void | Promise<void>
  disabled?: boolean
  routing?: boolean
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const update = async (next: BrowserProfile[], added = false) => {
    if (busy || disabled) return
    setBusy(true)
    setError('')
    try {
      const parsed = decodeResult(browserProfilesSchema, next)
      if (!parsed.success)
        throw new Error(
          'Check the profile details. Each link domain must be valid and assigned to only one profile.',
        )
      await save(parsed.data)
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
          key={`${profile.id}:${profile.name}:${profile.emoji}:${profile.language}:${profile.linkDomains?.join()}`}
          profile={profile}
          routing={routing}
          disabled={disabled || busy}
          onSave={(name, language, linkDomains, emoji) =>
            void update(
              profiles.map((item) =>
                item.id === profile.id ? { ...item, name, emoji, language, linkDomains } : item,
              ),
            )
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
        {routing
          ? 'Use comma-separated domain or domain/path rules. Paths match that page and its subpaths; the longest path wins, then exact domains. *.example.com matches subdomains. A rule can belong to one profile. '
          : ''}
        Removing a profile keeps its saved website data.
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
      description="Preview defaults and local profiles stay on this device. Remote profiles and logins stay on the selected computer."
    >
      <DefaultBrowser />
      <SettingsGroup title="Browser previews">
        <SettingRow
          label="Open links in"
          description="Choose how links that open another page appear in Studio’s browser."
        >
          <SettingsSelect
            label="Open links in"
            value={preferences.browserLinkOpening}
            options={[
              ['preview', 'Link preview'],
              ['tab', 'New tab'],
            ]}
            onChange={(browserLinkOpening) => updateAppPreferences({ browserLinkOpening })}
          />
        </SettingRow>
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
      <SettingsGroup
        title="Tab cleanup"
        description="Timers are saved on this device. 0 turns a timer off. The current tab, pinned tabs, Keep awake pages and active media are protected. Checks run when Browser is open."
      >
        {(
          [
            ['browserAutoSettleMinutes', 'Auto-settle unused tabs after (minutes)'],
            ['browserCloseSettledMinutes', 'Close settled tabs after (minutes)'],
          ] as const
        ).map(([key, label]) => (
          <SettingRow key={key} label={label}>
            <Input
              type="number"
              className="w-28"
              aria-label={label}
              min={0}
              max={525600}
              step={1}
              value={preferences[key]}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber
                if (Number.isInteger(value) && value >= 0 && value <= 525600)
                  updateAppPreferences({ [key]: value })
              }}
            />
          </SettingRow>
        ))}
      </SettingsGroup>
      {browser && (
        <SettingsGroup
          title="Local browser profiles"
          description="Used by regular tabs on this desktop. Domain rules also handle links sent from other apps when Dovo is chosen as their browser. Rules preserve private tabs and sign-in popup sessions."
        >
          <div className="space-y-3 p-4">
            <Profiles
              profiles={preferences.browserProfiles}
              routing
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
              {runtimes.length > 1 && (
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
              )}
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
