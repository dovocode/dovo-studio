import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useSettingsDraft, useConfirmSettingsNavigation, useConfirmation } from '@dovo/studio-core'
import {
  runtimeComputerName,
  browserLanguageSchema,
  decodeResult,
  normalizeBrowserLinkDomain,
  browserProfilesSchema,
  browserSearchProviders,
  browserSearchEngineSchema,
  type BrowserSearchEngine,
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
import { SettingsPage, SettingsGroup, SettingRow, Toggle } from './layout'
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
  saving,
}: {
  profile: BrowserProfile
  disabled: boolean
  routing: boolean
  saving: boolean
  onSave: (profile: BrowserProfile) => Promise<boolean>
  onRemove: () => void
}) {
  const uiText = useInterfaceText()

  const [edits, setEdits] = useState<
    Partial<{
      name: string
      emoji: string
      language: string
      doNotTrack: boolean
      keepSessionCookies: boolean
      engine: BrowserSearchEngine['engine']
      searchUrl: string
      domains: string
    }>
  >({})
  const saved = {
    name: profile.name,
    emoji: profile.emoji ?? '',
    language: profile.language ?? 'en-US',
    doNotTrack: profile.doNotTrack === true,
    keepSessionCookies: profile.keepSessionCookies === true,
    engine: profile.search?.engine ?? 'google',
    searchUrl: profile.search?.engine === 'custom' ? profile.search.url : '',
    domains: (profile.linkDomains ?? []).join(', '),
  }
  const { name, emoji, language, doNotTrack, keepSessionCookies, engine, searchUrl, domains } = {
    ...saved,
    ...edits,
  }
  const dirty = Object.entries(edits).some(([key, value]) => Reflect.get(saved, key) !== value)
  useSettingsDraft(dirty, saving)
  // When an external update acknowledges one edited field, stop overriding that field.
  useEffect(() => {
    setEdits((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key, value]) => Reflect.get(saved, key) !== value),
      ),
    )
  }, [profile])
  const setName = (name: string) => setEdits((current) => ({ ...current, name }))
  const setEmoji = (emoji: string) => setEdits((current) => ({ ...current, emoji }))
  const setLanguage = (language: string) => setEdits((current) => ({ ...current, language }))
  const setDoNotTrack = (doNotTrack: boolean) => setEdits((current) => ({ ...current, doNotTrack }))
  const setKeepSessionCookies = (keepSessionCookies: boolean) =>
    setEdits((current) => ({ ...current, keepSessionCookies }))
  const setEngine = (engine: BrowserSearchEngine['engine']) =>
    setEdits((current) => ({ ...current, engine }))
  const setSearchUrl = (searchUrl: string) => setEdits((current) => ({ ...current, searchUrl }))
  const setDomains = (domains: string) => setEdits((current) => ({ ...current, domains }))
  const search: BrowserSearchEngine =
    engine === 'custom' ? { engine, url: searchUrl.trim() } : { engine }
  const validSearch = decodeResult(browserSearchEngineSchema, search).success
  const unchangedSearch =
    JSON.stringify(search) === JSON.stringify(profile.search ?? { engine: 'google' })
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
      className="studio-browser-profile-fields flex flex-wrap items-center gap-2"
      onSubmit={async (event) => {
        event.preventDefault()
        if (validLanguage && validDomains && validSearch)
          if (
            await onSave({
              ...profile,
              name: name.trim(),
              language: Intl.getCanonicalLocales(language)[0]!,
              linkDomains,
              emoji: emoji || undefined,
              search,
              keepSessionCookies,
              doNotTrack,
            })
          )
            setEdits({})
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
      <label className="flex min-w-0 flex-1 basis-36 flex-col gap-1 text-xs text-muted-foreground">
        Profile name
        <Input
          aria-label={`Name for ${profile.name}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          disabled={disabled}
        />
      </label>
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
      <label className="flex min-w-0 flex-1 basis-36 flex-col gap-1 text-xs text-muted-foreground">
        Default search engine
        <ChoicePicker
          aria-label={`Search engine for ${profile.name}`}
          value={engine}
          disabled={disabled}
          onValueChange={(value) => {
            if (value === 'custom') setEngine(value)
            else {
              const provider = browserSearchProviders.find((provider) => provider.id === value)
              if (provider) setEngine(provider.id)
            }
          }}
        >
          {browserSearchProviders.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
          <option value="custom">Custom URL</option>
        </ChoicePicker>
      </label>
      {engine === 'custom' && (
        <label className="flex min-w-0 basis-full flex-col gap-1 text-xs text-muted-foreground">
          Search URL · use %s for the search term
          <Input
            aria-label={`Search URL for ${profile.name}`}
            value={searchUrl}
            onChange={(event) => setSearchUrl(event.target.value)}
            placeholder="https://example.com/search?q=%s"
            maxLength={4096}
            disabled={disabled}
            aria-invalid={!validSearch}
          />
          {!validSearch && (
            <span role="alert">Enter an HTTP or HTTPS URL containing %s, without credentials.</span>
          )}
        </label>
      )}
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
      <label className="flex basis-full items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          aria-label={`Send Do Not Track for ${profile.name}`}
          checked={doNotTrack}
          disabled={disabled}
          onChange={(event) => setDoNotTrack(event.target.checked)}
        />
        <span>
          Send Do Not Track
          <span className="block">
            Ask websites not to track your browsing. Websites decide whether to honor this request.
          </span>
        </span>
      </label>
      <label className="flex basis-full items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          aria-label={`Keep signed in across restarts for ${profile.name}`}
          checked={keepSessionCookies}
          disabled={disabled}
          onChange={(event) => setKeepSessionCookies(event.target.checked)}
        />
        <span>
          Keep signed in across restarts
          <span className="block">
            Retain session cookies. Websites can still require you to sign in again.
          </span>
        </span>
      </label>
      <Button
        title={`Save name for ${profile.name}`}
        size="sm"
        type="submit"
        disabled={
          disabled ||
          !name.trim() ||
          !validLanguage ||
          !validDomains ||
          !validSearch ||
          (!dirty && unchangedSearch)
        }
      >
        {uiText('Save')}
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
          {uiText('Remove')}
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
  useSettingsDraft(!!name.trim(), busy)
  const confirm = useConfirmation(JSON.stringify([profiles, disabled, busy]))
  const update = async (next: BrowserProfile[], added = false) => {
    if (busy || disabled) return false
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
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
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
          key={profile.id}
          profile={profile}
          routing={routing}
          disabled={disabled || busy}
          saving={busy}
          onSave={(updated) =>
            update(profiles.map((item) => (item.id === profile.id ? updated : item)))
          }
          onRemove={async () => {
            if (
              await confirm({
                title: 'Remove browser profile?',
                description:
                  'This profile will leave the picker. Its saved website data will remain on this computer.',
                confirmLabel: 'Remove profile',
                destructive: true,
              })
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
      {catalog.applyError && (
        <div role="alert" className="space-y-2 text-xs">
          <p>
            Profiles are saved. Some open browser settings could not apply: {catalog.applyError}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={!catalog.connected || catalog.applying}
            onClick={() => void catalog.retryApply()}
          >
            {catalog.applying ? 'Applying…' : 'Retry browser settings'}
          </Button>
        </div>
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
  const uiText = useInterfaceText()

  const preferences = useAppPreferences()
  const confirmNavigation = useConfirmSettingsNavigation()
  const { browser } = useStudioHost()
  const { runtimes, activeRuntimeId } = useWorkspace()
  const [runtimeId, setRuntimeId] = useState(activeRuntimeId ?? '')
  const runtime = runtimes.find((entry) => entry.profile.id === runtimeId) ?? runtimes[0]
  return (
    <SettingsPage
      title={uiText('Browser')}
      description="Configure previews and browsing profiles. Remote profiles and logins stay on the selected computer."
      storageInfo={<span>This device · preferences save automatically; profiles use Save</span>}
    >
      <DefaultBrowser />
      <SettingsGroup title="Tab order">
        <SettingRow
          label="Order tabs by activity"
          description="Pinned tabs always keep their manual order. Turn this off to drag other tabs into order."
        >
          <Toggle
            label="Order tabs by activity"
            checked={preferences.browserSortByActivity}
            onChange={(checked) => updateAppPreferences({ browserSortByActivity: checked })}
          />
        </SettingRow>
      </SettingsGroup>
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
          description="You can change the viewport in each preview."
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
          saveRequired
          description="Edit a profile, then choose Save to apply its changes. Used by regular tabs on this desktop. Domain rules also handle links sent from other apps when Dovo is chosen as their browser. Rules preserve private tabs and sign-in popup sessions."
        >
          <div className="space-y-3 p-4">
            <Profiles
              profiles={preferences.browserProfiles}
              routing
              save={(browserProfiles) => {
                if (!updateAppPreferences({ browserProfiles }))
                  throw new Error('Could not save profiles on this device. Retry saving settings.')
              }}
            />
          </div>
        </SettingsGroup>
      )}
      <SettingsGroup
        title="Remote browser profiles"
        saveRequired={runtime?.connected === true}
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
                    onValueChange={(id) => {
                      void confirmNavigation().then((allowed) => {
                        if (allowed) setRuntimeId(id)
                      })
                    }}
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
                key={JSON.stringify([runtime.profile.id, runtime.profile.connection])}
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
