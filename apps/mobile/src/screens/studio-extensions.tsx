import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { ExtensionMarketplace } from './extension-marketplace'
import { ExtensionComponents, ExtensionSettingsConflicts } from './studio-extension-components'
import { useState } from 'react'
import { Alert, ScrollView, Switch, View } from 'react-native'
import { router, type Href } from 'expo-router'
import {
  decode,
  runtimeComputerName,
  studioExtensionManifestSchema,
  type ExtensionContribution,
  type StudioExtensionEntry,
} from '@dovo/protocol'
import {
  callStudioExtension,
  openStudioExtension,
  useStudioExtensions,
  useExtensionSettingsDraft,
  extensionComponentVersion,
  type SaveExtensionSettings,
} from '@dovo/studio-core'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { Action } from '../ui/controls/action'
import { Choice } from '../ui/controls/choice'
import { Field } from '../ui/controls/field'
import { McpAppView } from '../ui/content/mcp-app'
import { Text } from '../ui/content/text'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Sheet } from '../ui/layout/sheet'
import { useTheme } from '../ui/theme'

const row = { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as const
const destination = {
  tasks: '/',
  terminal: '/terminal',
  browser: '/browser',
  dashboards: '/dashboards',
  jobs: '/settings/automations',
  pulls: '/pulls',
} satisfies Record<Extract<ExtensionContribution, { kind: 'studio' }>['destination'], Href>

export default function StudioExtensionsScreen() {
  const uiText = useInterfaceText()
  const { activeId, overviews } = useRuntime()
  const [owner, setOwner] = useState(activeId ?? '')
  const sources = overviews.filter((entry) => entry.snapshot?.studioExtensionsSupported)
  const source = sources.find((entry) => entry.profile.id === owner) ?? sources[0]
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title={uiText('Studio extensions')} />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        {source ? (
          <>
            <Choice
              label={uiText('Computer')}
              value={source.profile.id}
              items={sources.map((entry) => ({
                id: entry.profile.id,
                name: runtimeComputerName(entry),
              }))}
              onChange={setOwner}
            />
            <RuntimeScope key={source.profile.id} runtimeId={source.profile.id}>
              <ExtensionsList />
            </RuntimeScope>
          </>
        ) : (
          <Text>{uiText('Update a paired computer to manage Studio extensions.')}</Text>
        )}
      </ScrollView>
    </View>
  )
}

function ExtensionsList() {
  const uiText = useInterfaceText()
  const { read, connected, snapshot } = useRuntime()
  const state = useStudioExtensions(
    read,
    connected,
    null,
    snapshot?.studioExtensionsRevision,
    extensionComponentVersion(snapshot),
  )
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [marketplace, setMarketplace] = useState(false)
  const { colors } = useTheme()
  const [review, setReview] = useState<StudioExtensionEntry>()
  const reviewChanged =
    review && state.entries.find((entry) => entry.id === review.id)?.revision !== review.revision
  async function stage() {
    try {
      const manifest = decode(studioExtensionManifestSchema, JSON.parse(source))
      setError('')
      const current = state.entries.find((entry) => entry.id === manifest.id)
      if (
        await state.change({ action: 'stage', manifest, expectedRevision: current?.revision ?? 0 })
      )
        setSource('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <>
      {!connected && <Text>{uiText('Computer offline.')}</Text>}
      {(error || state.error) && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error || state.error}
        </Text>
      )}
      <View style={row}>
        <Text>{uiText('Allow agents to install their own extensions on this computer')}</Text>
        <Switch
          accessibilityLabel={uiText('Allow agent installation')}
          value={state.allowAgentInstall}
          disabled={!connected || !state.loaded || state.busy}
          onValueChange={(enabled) =>
            void state.change({ action: 'agent-install-policy', enabled })
          }
        />
      </View>
      <View style={row}>
        <Action
          label={adding ? uiText('Close manifest editor') : uiText('Add extension manifest')}
          secondary
          onPress={() => setAdding(!adding)}
        />
        <Action
          label={uiText('Reload extensions')}
          secondary
          disabled={!connected || state.busy}
          onPress={() => void state.load()}
        />
      </View>
      {snapshot?.studioExtensionMarketplaceSupported && (
        <>
          <Action
            label={
              marketplace ? uiText('Close marketplace') : uiText('Browse extension marketplace')
            }
            secondary
            onPress={() => setMarketplace(!marketplace)}
          />
          {marketplace && (
            <ExtensionMarketplace
              entries={state.entries}
              busy={state.busy || !state.loaded}
              stage={state.change}
              review={setReview}
            />
          )}
        </>
      )}
      {adding && (
        <>
          <Field
            label={uiText('Extension manifest JSON')}
            value={source}
            onChangeText={setSource}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Action
            label={uiText('Stage manifest')}
            disabled={!connected || state.busy || !source.trim()}
            onPress={() => void stage()}
          />
        </>
      )}
      {state.entries.map((entry) => {
        const save: SaveExtensionSettings = (settings) => state.saveSettings(entry, settings)
        return (
          <View
            key={entry.id}
            style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 12, gap: 8 }}
          >
            <Text accessibilityRole="header" style={{ fontWeight: '600' }}>
              {entry.installed?.name ?? entry.draft?.name ?? entry.id}
            </Text>
            <Text>
              {entry.id} ·{' '}
              {entry.enabled
                ? uiText('Enabled')
                : entry.installed
                  ? uiText('Disabled')
                  : uiText('Draft')}
            </Text>
            {entry.error && <Text accessibilityRole="alert">{entry.error}</Text>}
            <View style={row}>
              {entry.draft && (
                <>
                  <Action
                    secondary
                    label={uiText('Review draft')}
                    disabled={!connected || state.busy}
                    onPress={() => setReview(entry)}
                  />
                  <Action
                    secondary
                    label={uiText('Discard draft')}
                    disabled={!connected || state.busy}
                    onPress={() =>
                      void state.change({
                        action: 'discard',
                        id: entry.id,
                        expectedRevision: entry.revision,
                      })
                    }
                  />
                </>
              )}
              {entry.installed && (
                <Action
                  label={entry.enabled ? uiText('Disable extension') : uiText('Enable extension')}
                  secondary
                  disabled={!connected || state.busy}
                  onPress={() =>
                    void state.change({
                      action: entry.enabled ? 'disable' : 'enable',
                      id: entry.id,
                      expectedRevision: entry.revision,
                    })
                  }
                />
              )}
              {entry.canRollback && (
                <Action
                  label={uiText('Restore previous version')}
                  secondary
                  disabled={!connected || state.busy}
                  onPress={() =>
                    void state.change({
                      action: 'rollback',
                      id: entry.id,
                      expectedRevision: entry.revision,
                    })
                  }
                />
              )}
              <Action
                label={uiText('Remove extension')}
                secondary
                disabled={!connected || state.busy}
                onPress={() =>
                  Alert.alert(uiText('Remove extension?'), entry.id, [
                    { text: uiText('Cancel'), style: 'cancel' },
                    {
                      text: uiText('Remove'),
                      style: 'destructive',
                      onPress: () =>
                        void state.change({
                          action: 'remove',
                          id: entry.id,
                          expectedRevision: entry.revision,
                        }),
                    },
                  ])
                }
              />
            </View>
            <ExtensionSettings entry={entry} disabled={!connected || state.busy} save={save} />
            {entry.enabled &&
              entry.installed?.contributions.map((item) =>
                item.kind === 'view' ? (
                  <ExtensionViewSection
                    key={item.id}
                    entry={entry}
                    contribution={item}
                    save={save}
                  />
                ) : (
                  <ExtensionAction key={JSON.stringify(item)} entry={entry} contribution={item} />
                ),
              )}
          </View>
        )
      })}
      {review && (
        <Sheet
          title={uiText('Review proposed manifest')}
          busy={state.busy}
          onClose={() => setReview(undefined)}
          footer={
            <Action
              label={uiText('Install draft')}
              disabled={!connected || state.busy || reviewChanged}
              onPress={async () => {
                if (
                  await state.change({
                    action: 'install',
                    id: review.id,
                    expectedRevision: review.revision,
                  })
                )
                  setReview((current) => (current === review ? undefined : current))
              }}
            />
          }
        >
          {reviewChanged && (
            <Text accessibilityRole="alert">
              {uiText('This draft changed. Close this review and open the new draft.')}
            </Text>
          )}
          {state.error && <Text accessibilityRole="alert">{state.error}</Text>}
          <Text selectable>{JSON.stringify(review.draft, null, 2)}</Text>
        </Sheet>
      )}
    </>
  )
}

function ExtensionViewSection({
  entry,
  contribution,
  save,
}: {
  entry: StudioExtensionEntry
  contribution: Extract<ExtensionContribution, { kind: 'view' }>
  save: SaveExtensionSettings
}) {
  const [open, setOpen] = useState(false)
  const content = <ExtensionComponents entry={entry} contribution={contribution} save={save} />
  if (contribution.placement === 'tool')
    return (
      <>
        <Action secondary label={contribution.title} onPress={() => setOpen(!open)} />
        {open && (
          <Sheet title={contribution.title} onClose={() => setOpen(false)}>
            {content}
          </Sheet>
        )}
      </>
    )
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ fontWeight: '600' }}>
        {contribution.title}
      </Text>
      {content}
    </View>
  )
}

function ExtensionSettings({
  entry,
  disabled,
  save,
}: {
  entry: StudioExtensionEntry
  disabled: boolean
  save: SaveExtensionSettings
}) {
  const uiText = useInterfaceText()
  const {
    values: settings,
    dirty,
    conflicts,
    resolveConflicts,
    edit,
    commit,
    saving,
    error,
  } = useExtensionSettingsDraft(entry, save)
  const fields = entry.installed?.settings
  if (!fields?.length) return null
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header">
        {uiText('{name} settings', { name: entry.installed?.name })}
      </Text>
      {fields.map((field) =>
        typeof field.default === 'boolean' ? (
          <View key={field.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text>{field.title}</Text>
            <Switch
              accessibilityLabel={field.title}
              value={settings[field.id] === true}
              disabled={disabled || saving}
              onValueChange={(value) => edit(field.id, value)}
            />
          </View>
        ) : (
          <Field
            key={field.id}
            label={field.title}
            value={String(settings[field.id] ?? field.default)}
            maxLength={4096}
            editable={!disabled && !saving}
            onChangeText={(value) => edit(field.id, value)}
          />
        ),
      )}
      <ExtensionSettingsConflicts
        conflicts={conflicts}
        resolveConflicts={resolveConflicts}
        busy={saving}
      />
      <Action
        label={uiText('Save extension settings')}
        secondary
        disabled={disabled || saving || !dirty || conflicts.length > 0}
        onPress={() => void commit()}
      />
      {error && <Text accessibilityRole="alert">{error}</Text>}
    </View>
  )
}

export function MobileExtensionTile({
  id,
  contributionId,
  visible,
}: {
  id: string
  contributionId: string
  visible: boolean
}) {
  const uiText = useInterfaceText()
  const { read, connected, snapshot } = useRuntime()
  const state = useStudioExtensions(
    read,
    visible && connected && snapshot?.studioExtensionsSupported === true,
    null,
    snapshot?.studioExtensionsRevision,
    extensionComponentVersion(snapshot),
  )
  const entry = visible
    ? state.entries.find((entry) => entry.id === id && entry.enabled)
    : undefined
  const contribution =
    entry && entry.installed?.contributions.find((item) => item.id === contributionId)
  if (entry && contribution?.kind === 'view')
    return (
      <View style={{ gap: 8 }}>
        {!connected && <Text>{uiText('Computer offline.')}</Text>}
        <ExtensionComponents
          key={`${entry.id}/${contribution.id}`}
          entry={entry}
          contribution={contribution}
          save={(settings) => state.saveSettings(entry, settings)}
        />
      </View>
    )
  return connected && entry && contribution && contribution.kind !== 'view' ? (
    <ExtensionAction
      key={JSON.stringify([entry.id, contribution])}
      entry={entry}
      contribution={contribution}
    />
  ) : (
    <>
      <Text>{state.error || uiText('This extension contribution is unavailable.')}</Text>
      <Action
        label={uiText('Reload extension')}
        secondary
        disabled={!connected}
        onPress={() => void state.load()}
      />
    </>
  )
}

function ExtensionAction({
  entry,
  contribution,
}: {
  entry: StudioExtensionEntry
  contribution: Exclude<ExtensionContribution, { kind: 'view' }>
}) {
  const uiText = useInterfaceText()
  const { read, connected } = useRuntime()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function activate() {
    if (open) {
      setOpen(false)
      return
    }
    if (busy) return
    setBusy(true)
    setError('')
    setResult('')
    try {
      if (contribution.kind === 'tool') {
        setResult(
          JSON.stringify((await callStudioExtension(read, entry, contribution.id)).data, null, 2),
        )
      } else {
        const { contribution: opened } = await openStudioExtension(read, entry, contribution.id)
        if (opened.kind === 'studio') router.navigate(destination[opened.destination])
        else if (opened.kind === 'app') setOpen(true)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Action
        label={open ? uiText('Close app') : busy ? uiText('Running…') : contribution.title}
        secondary
        disabled={!connected || busy}
        onPress={() => void activate()}
      />
      {error && <Text accessibilityRole="alert">{error}</Text>}
      {result && <Text selectable>{result}</Text>}
      {open && connected && contribution.kind === 'app' && (
        <McpAppView
          visible
          reference={{
            id: contribution.appId,
            taskId: contribution.taskId,
            title: contribution.title,
          }}
        />
      )}
    </>
  )
}
