import {
  useSettingsDraft,
  useConfirmSettingsNavigation,
} from '../runtime/preferences/settings-target'
import { openExtensionPage } from '../shell/extension-page-route'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { ExtensionMarketplace } from './extension-marketplace'
import { AgentPlugins } from './agent-plugins'
import { ExtensionComponents, ExtensionSettingsConflicts } from './studio-extension-components'
import { useState } from 'react'
import { ExtensionAction } from './studio-extension-action'
import { Alert, ScrollView, Switch, View } from 'react-native'
import {
  decode,
  extensionViewHasApp,
  isStudioDataSource,
  runtimeComputerName,
  studioExtensionManifestSchema,
  type ExtensionContribution,
  type StudioExtensionEntry,
} from '@dovo/protocol'
import {
  useStudioExtensions,
  useExtensionSettingsDraft,
  extensionComponentVersion,
  type SaveExtensionSettings,
} from '@dovo/studio-core'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { Action } from '../ui/controls/action'
import { Choice } from '../ui/controls/choice'
import { Field } from '../ui/controls/field'
import { Text } from '../ui/content/text'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Sheet } from '../ui/layout/sheet'
import { useTheme } from '../ui/theme'

const row = { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as const
export default function StudioExtensionsScreen() {
  const uiText = useInterfaceText()
  const { activeId, overviews } = useRuntime()
  const [owner, setOwner] = useState(activeId ?? '')
  const confirmNavigation = useConfirmSettingsNavigation()
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
              onChange={(id) => confirmNavigation(() => setOwner(id))}
            />
            <RuntimeScope key={source.profile.id} runtimeId={source.profile.id}>
              <ExtensionsList />
              {source.snapshot?.harnessPluginsSupported ? (
                <AgentPlugins />
              ) : (
                <Text>
                  {uiText(
                    'Update the runtime on this computer to install Claude Code and Codex plugins.',
                  )}
                </Text>
              )}
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
  const confirmNavigation = useConfirmSettingsNavigation()
  const uiText = useInterfaceText()
  const { read, connected, snapshot, activeId } = useRuntime()
  const state = useStudioExtensions(
    read,
    connected,
    null,
    snapshot?.studioExtensionsRevision,
    extensionComponentVersion(snapshot),
  )
  const [source, setSource] = useState('')
  useSettingsDraft(!!source.trim(), !!source.trim() && state.busy)
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
      if (
        !snapshot?.studioExtensionAppViewsSupported &&
        manifest.contributions.some(
          (item) => item.kind === 'view' && extensionViewHasApp(item.view),
        )
      )
        throw new Error('Update the paired computer to embed MCP Apps in extension views.')
      if (
        !snapshot?.studioExtensionPinnedPages &&
        manifest.contributions.some(
          (contribution) => contribution.kind === 'view' && contribution.placement === 'page',
        )
      )
        throw new Error(uiText('Update the paired computer to use extension pages.'))
      setError('')
      if (!snapshot?.studioDataSourcesSupported && manifest.contributions.some(isStudioDataSource))
        throw new Error(uiText('Update the paired computer to use extension data sources.'))
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
                item.kind === 'view' && item.placement === 'page' ? (
                  <Action
                    key={item.id}
                    secondary
                    label={item.title}
                    disabled={!activeId}
                    onPress={() => {
                      if (activeId)
                        confirmNavigation(() => openExtensionPage(activeId, entry.id, item.id))
                    }}
                  />
                ) : item.kind === 'view' ? (
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
  useSettingsDraft(dirty, saving)
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
  return entry &&
    contribution &&
    contribution.kind !== 'view' &&
    (connected || isStudioDataSource(contribution)) ? (
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
