import {
  useConfirmSettingsNavigation,
  useSettingsDraft,
} from '../runtime/preferences/settings-target'
import { MobileDataSource } from './studio-data-source'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { DataView } from './dashboard-data-view'
import { MobileExtensionTile } from './studio-extensions'
import { useRef, useState } from 'react'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import WebView from 'react-native-webview'
import {
  STUDIO_BROWSER_SCOPE,
  runtimeComputerName,
  isStudioDataSource,
  needsStudioDataSources,
  studioDataPanelLimit,
  type StudioDataPanel,
  SCRATCH_PROJECT_ID,
  type Dashboard,
  type DashboardTile,
} from '@dovo/protocol'
import {
  dashboardTemplate,
  dashboardTemplateFilename,
  dashboardTemplateMime,
  maxDashboardTemplateBytes,
  importDashboardTemplate,
  dashboardTileFields,
  dashboardDisplayLabels,
  isDashboardDisplay,
  readDashboardDataSource,
  dashboardTileLabels,
  moveDashboardTile,
  newDashboardTile,
  useDashboardTile,
  useDashboards,
  extensionTileOptions,
  useStudioExtensions,
  extensionComponentVersion,
} from '@dovo/studio-core'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { router } from 'expo-router'
import { automationHref, pipelineHref } from '../shell/source-route'
import { shareAttachment } from '../tasks/conversation/components/attachment-share'
import { useNavigation } from '../shell/navigation'
import { TerminalSession } from '../terminal/terminal-session'
import { Action } from '../ui/controls/action'
import { Choice } from '../ui/controls/choice'
import { Field } from '../ui/controls/field'
import { Icon } from '../ui/controls/icon'
import { McpAppView } from '../ui/content/mcp-app'
import { RemoteBrowser } from '../tasks/preview/remote-browser'
import { Text } from '../ui/content/text'
import { SafeModal } from '../ui/layout/safe-modal'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Sheet, type SheetHandle } from '../ui/layout/sheet'
import { useTheme } from '../ui/theme'
import { MobileRemoteDesktop } from './remote-desktop'

const tileKinds = Object.keys(dashboardTileLabels).filter((kind): kind is DashboardTile['kind'] =>
  Object.hasOwn(dashboardTileLabels, kind),
)
const row = { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as const

export default function DashboardsScreen() {
  const uiText = useInterfaceText()
  const { overviews, activeId } = useRuntime()
  const { navigate } = useNavigation()
  const [owner, setOwner] = useState(activeId ?? '')
  const computers = overviews.filter((entry) => entry.snapshot?.dashboardsSupported)
  const selected =
    computers.find((entry) => entry.profile.id === owner) ??
    computers.find((entry) => entry.profile.id === activeId) ??
    computers[0]
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title={uiText('Dashboards')} onBack={() => navigate('tasks')} />
      {selected ? (
        <RuntimeScope key={selected.profile.id} runtimeId={selected.profile.id}>
          <Board
            owner={selected.profile.id}
            computers={computers.map((entry) => ({
              id: entry.profile.id,
              name: runtimeComputerName(entry),
            }))}
            setOwner={setOwner}
          />
        </RuntimeScope>
      ) : (
        <Text>{uiText('Connect a computer with dashboard support.')}</Text>
      )}
    </View>
  )
}

function Board({
  owner,
  computers,
  setOwner,
}: {
  owner: string
  computers: { id: string; name: string }[]
  setOwner: (id: string) => void
}) {
  const uiText = useInterfaceText()
  const { read, connected, readCache, snapshot } = useRuntime()
  const { focused } = useNavigation()
  const { colors } = useTheme()
  const dataSources = snapshot?.studioDataSourcesSupported === true
  const state = useDashboards(read, connected, readCache, focused, dataSources)
  const { dashboard, draft } = state
  useSettingsDraft(state.dirty, !!draft && state.pending)
  const confirmNavigation = useConfirmSettingsNavigation()
  const supported = snapshot?.studioExtensionsSupported === true
  const extensions = useStudioExtensions(
    read,
    focused &&
      connected &&
      supported &&
      (draft?.tiles.some((tile) => tile.kind === 'extension') ?? false),
    null,
    snapshot?.studioExtensionsRevision,
    extensionComponentVersion(snapshot),
  )
  const extensionOptions = extensionTileOptions(extensions.entries)
  const availableKinds = tileKinds.filter(
    (kind) => (kind !== 'extension' || supported) && (kind !== 'cli' || dataSources),
  )
  const needsUpdate = !!draft && !dataSources && needsStudioDataSources(draft)

  const [editingTile, setEditingTile] = useState<string>()
  const [menu, setMenu] = useState<'actions' | 'tiles'>()
  const sheet = useRef<SheetHandle>(null)
  const choose = (action: () => void) => sheet.current?.dismiss(action)
  const [template, setTemplate] = useState<string>()
  const [templateError, setTemplateError] = useState('')
  const [importedId, setImportedId] = useState('')
  const [fileBusy, setFileBusy] = useState(false)

  async function transferFile(transfer: () => Promise<void>) {
    setFileBusy(true)
    setTemplateError('')
    try {
      await transfer()
    } catch (cause) {
      setTemplateError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setFileBusy(false)
    }
  }

  function importFile() {
    return transferFile(async () => {
      const selection = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: '*/*',
      })
      if (selection.canceled) return
      const asset = selection.assets[0]
      const file = asset.file ?? new File(asset.uri)
      if (Math.max(asset.size ?? 0, file.size) > maxDashboardTemplateBytes)
        throw new Error(uiText('Choose a dashboard file of 1 MB or less.'))
      openTemplate(await file.text())
    })
  }

  function exportFile(dashboard: Dashboard) {
    return transferFile(() =>
      shareAttachment(
        dashboardTemplateFilename(dashboard.title),
        dashboardTemplateMime,
        dashboardTemplate(dashboard),
        'utf8',
      ),
    )
  }
  function openTemplate(source: string) {
    const imported = importDashboardTemplate(source)
    state.beginEdit(imported)
    setEditingTile(imported.tiles[0]?.id)
    setImportedId(imported.id)
    setTemplate(undefined)
    setTemplateError('')
  }

  function importTemplate() {
    if (template === undefined) return
    try {
      openTemplate(template)
    } catch (cause) {
      setTemplateError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      {draft ? (
        <Field
          label={uiText('Dashboard title')}
          maxLength={100}
          value={draft.title}
          editable={!state.pending}
          onChangeText={(title) => state.edit({ ...draft, title })}
        />
      ) : (
        <>
          {computers.length > 1 && (
            <Choice
              label={uiText('Computer')}
              value={owner}
              items={computers}
              onChange={setOwner}
              disabled={state.pending || fileBusy}
            />
          )}
          {state.dashboards.length > 0 && (
            <Choice
              label={uiText('Dashboard')}
              value={dashboard?.id ?? ''}
              items={state.dashboards.map((item) => ({ id: item.id, name: item.title }))}
              onChange={state.select}
              disabled={state.pending || fileBusy}
            />
          )}
        </>
      )}
      {!connected && (
        <Text accessibilityRole="alert">
          {uiText('Computer offline. Save your edits when it reconnects.')}
        </Text>
      )}
      {state.cacheError && <Text>{state.cacheError}</Text>}
      {state.error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {state.error}
        </Text>
      )}
      <View style={row}>
        {draft ? (
          <>
            <Action
              label={uiText('Save dashboard')}
              disabled={!connected || state.pending || needsUpdate}
              onPress={() => void state.save()}
            />
            {draft.revision > 0 && state.error && (
              <Action
                label={uiText('Keep as new dashboard')}
                secondary
                disabled={state.pending}
                onPress={state.copyDraft}
              />
            )}
            <Action
              label={uiText('Cancel edits')}
              secondary
              disabled={state.pending}
              onPress={() => confirmNavigation(() => state.edit(undefined))}
            />
          </>
        ) : (
          <>
            <Action
              label={uiText('New dashboard')}
              variant={dashboard ? 'outline' : 'default'}
              disabled={state.pending || fileBusy}
              onPress={() => {
                setEditingTile(undefined)
                state.create()
              }}
            />
            {dashboard && (
              <Action
                label={uiText('Edit dashboard')}
                variant="outline"
                disabled={state.pending || fileBusy}
                onPress={() => {
                  setEditingTile(dashboard.tiles[0]?.id)
                  state.beginEdit(dashboard)
                }}
              />
            )}
            <Action
              label={uiText('Dashboard actions')}
              icon="more"
              secondary
              disabled={state.pending || fileBusy}
              onPress={() => setMenu('actions')}
            />
          </>
        )}
      </View>
      {menu === 'actions' && (
        <Sheet ref={sheet} title={uiText('Dashboard actions')} onClose={() => setMenu(undefined)}>
          <Action
            label={uiText('Import dashboard')}
            secondary
            onPress={() => choose(() => void importFile())}
          />
          <Action
            label={uiText('Paste template')}
            secondary
            onPress={() =>
              choose(() => {
                setTemplate('')
                setTemplateError('')
              })
            }
          />
          {dashboard && (
            <>
              <Action
                label={uiText('Export dashboard')}
                secondary
                onPress={() => choose(() => void exportFile(dashboard))}
              />
              <Action
                label={uiText('View template')}
                secondary
                onPress={() =>
                  choose(() => {
                    setTemplate(dashboardTemplate(dashboard))
                    setTemplateError('')
                  })
                }
              />
            </>
          )}
          <Action
            label={uiText('Reload')}
            secondary
            disabled={!connected}
            onPress={() => choose(() => void state.load())}
          />
          {dashboard && (
            <Action
              label={uiText('Delete dashboard')}
              secondary
              disabled={!connected}
              destructive
              onPress={() =>
                choose(() => {
                  Alert.alert(uiText('Delete dashboard?'), dashboard.title, [
                    { text: uiText('Cancel'), style: 'cancel' },
                    {
                      text: uiText('Delete'),
                      style: 'destructive',
                      onPress: () => void state.remove(),
                    },
                  ])
                })
              }
            />
          )}
        </Sheet>
      )}
      {!draft && template !== undefined && (
        <>
          <Field
            label={uiText('Dashboard template (JSON)')}
            value={template}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTemplate}
          />
          <View style={row}>
            <Action
              label={uiText('Open as draft')}
              secondary
              disabled={!template.trim() || fileBusy}
              onPress={importTemplate}
            />
            <Action
              label={uiText('Close template')}
              secondary
              onPress={() => setTemplate(undefined)}
            />
          </View>
        </>
      )}
      {needsUpdate && (
        <Text accessibilityRole="alert">
          {uiText('Update the paired computer to use these data displays.')}
        </Text>
      )}
      {templateError && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {templateError}
        </Text>
      )}
      {draft && draft.id === importedId && (
        <Text>
          {uiText('Review the imported tiles and bind sources on this computer before you save.')}
        </Text>
      )}
      {draft ? (
        <>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text accessibilityRole="header" style={{ fontWeight: '600' }}>
              {uiText('Tiles')}
            </Text>
            <Action
              label={uiText('Add tile')}
              variant="outline"
              disabled={state.pending || draft.tiles.length >= 32}
              onPress={() => setMenu('tiles')}
            />
          </View>
          {menu === 'tiles' && (
            <Sheet ref={sheet} title={uiText('Add tile')} onClose={() => setMenu(undefined)}>
              {availableKinds.map((kind) => (
                <Action
                  key={kind}
                  label={uiText(dashboardTileLabels[kind])}
                  secondary
                  onPress={() =>
                    choose(() => {
                      const tile = newDashboardTile(kind)
                      state.edit({ ...draft, tiles: [...draft.tiles, tile] })
                      setEditingTile(tile.id)
                    })
                  }
                />
              ))}
            </Sheet>
          )}
          {draft.tiles.map((tile, index) => {
            const expanded = editingTile === tile.id
            const label = uiText(dashboardTileLabels[tile.kind])
            return (
              <View
                key={tile.id}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    minHeight: 48,
                    paddingHorizontal: 12,
                  }}
                  onPress={() => setEditingTile(expanded ? undefined : tile.id)}
                >
                  <Icon name="artifact" size={18} color={colors.muted} />
                  <Text numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>
                    {tile.title || label}
                  </Text>
                  {tile.title && tile.title !== label && (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
                  )}
                  <Icon name={expanded ? 'down' : 'next'} size={18} color={colors.muted} />
                </Pressable>
                {expanded && (
                  <TileEditor
                    extensionOptions={extensionOptions}
                    tile={tile}
                    disabled={state.pending}
                    change={(updated) =>
                      state.edit({
                        ...draft,
                        tiles: draft.tiles.map((entry) => (entry.id === tile.id ? updated : entry)),
                      })
                    }
                    move={(offset) =>
                      state.edit({ ...draft, tiles: moveDashboardTile(draft.tiles, index, offset) })
                    }
                    first={index === 0}
                    last={index === draft.tiles.length - 1}
                    remove={() => {
                      const remaining = draft.tiles.filter((entry) => entry.id !== tile.id)
                      state.edit({ ...draft, tiles: remaining })
                      setEditingTile(remaining[Math.min(index, remaining.length - 1)]?.id)
                    }}
                  />
                )}
              </View>
            )
          })}
        </>
      ) : dashboard?.tiles.length ? (
        dashboard.tiles.map((tile) => (
          <View
            key={`${dashboard.id}:${tile.id}:${dashboard.revision}`}
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 14,
              padding: 12,
              gap: 8,
            }}
          >
            <Text accessibilityRole="header" style={{ fontWeight: '600' }}>
              {tile.title}
            </Text>
            <TileContent dashboard={dashboard} tile={tile} />
          </View>
        ))
      ) : (
        <View style={{ alignItems: 'center', gap: 8, padding: 24 }}>
          <Icon name="artifact" size={24} color={colors.muted} />
          <Text style={{ color: colors.muted }}>
            {dashboard
              ? uiText('Edit this dashboard to add tiles.')
              : uiText('Create a dashboard to add your first tile.')}
          </Text>
        </View>
      )}
    </ScrollView>
  )
}

function TileEditor({
  tile,
  extensionOptions,
  change,
  move,
  first,
  last,
  remove,
  disabled,
}: {
  tile: DashboardTile
  extensionOptions: ReturnType<typeof extensionTileOptions>
  change: (tile: DashboardTile) => void
  move: (offset: number) => void
  first: boolean
  last: boolean
  remove: () => void
  disabled: boolean
}) {
  const uiText = useInterfaceText()
  const { snapshot } = useRuntime()
  const workspace = snapshot?.workspace
  const { colors } = useTheme()
  return (
    <View style={{ borderColor: colors.border, borderTopWidth: 1, padding: 12, gap: 8 }}>
      <Field
        label={uiText('Tile title')}
        value={tile.title}
        maxLength={100}
        editable={!disabled}
        onChangeText={(title) => change({ ...tile, title })}
      />
      {tile.kind === 'extension' && (
        <Choice
          label={uiText('Extension contribution')}
          value={`${tile.extensionId}/${tile.contributionId}`}
          selectedLabel={
            tile.extensionId
              ? (extensionOptions.find(
                  (option) => option.id === `${tile.extensionId}/${tile.contributionId}`,
                )?.name ?? `${tile.extensionId}/${tile.contributionId}`)
              : undefined
          }
          items={extensionOptions}
          disabled={disabled}
          onChange={(id) => {
            const option = extensionOptions.find((item) => item.id === id)
            if (option)
              change({
                ...tile,
                extensionId: option.extensionId,
                contributionId: option.contributionId,
              })
          }}
        />
      )}
      {tile.kind !== 'extension' &&
        dashboardTileFields(tile).map(([key, label, value]) => {
          const items =
            key === 'repositoryId'
              ? [
                  ...(workspace?.repositories.map((item) => ({ id: item.id, name: item.name })) ??
                    []),
                  ...(tile.kind === 'cli' &&
                  !workspace?.repositories.some((item) => item.id === SCRATCH_PROJECT_ID)
                    ? [{ id: SCRATCH_PROJECT_ID, name: uiText('No Project') }]
                    : []),
                ]
              : key === 'terminalId'
                ? snapshot?.terminals.map((item) => ({
                    id: item.id,
                    name: item.customTitle ?? item.title,
                  }))
                : key === 'taskId'
                  ? workspace?.tasks.map((item) => ({ id: item.id, name: item.title }))
                  : undefined
          const update = (next: string) => change({ ...tile, [key]: next })
          return items ? (
            <Choice
              key={key}
              label={uiText(label)}
              items={items}
              value={value}
              disabled={disabled}
              onChange={update}
            />
          ) : (
            <Field
              key={key}
              label={uiText(label)}
              value={value}
              editable={!disabled}
              autoCapitalize="none"
              autoCorrect={false}
              multiline={key === 'command' || key === 'arguments'}
              onChangeText={update}
            />
          )
        })}
      {isStudioDataSource(tile) && snapshot?.studioDataSourcesSupported && (
        <Field
          label={uiText('Refresh interval in seconds')}
          placeholder={uiText('Manual refresh')}
          keyboardType="number-pad"
          value={String(tile.refreshSeconds ?? '')}
          editable={!disabled}
          onChangeText={(value) => {
            if (!/^\d*$/.test(value)) return
            const { refreshSeconds: _, ...manual } = tile
            change(value ? { ...manual, refreshSeconds: Number(value) } : manual)
          }}
        />
      )}
      {(isStudioDataSource(tile) || tile.kind === 'mcp') && (
        <DisplayEditor
          tile={tile}
          change={change}
          compound={snapshot?.studioDataSourcesSupported === true}
          disabled={disabled}
        />
      )}
      {(['span', 'height'] as const).map((key) => (
        <Choice
          key={key}
          label={key === 'span' ? uiText('Desktop width') : uiText('Desktop height')}
          value={String(tile[key])}
          disabled={disabled}
          items={['1', '2', '3', '4'].map((id) => ({ id, name: id }))}
          onChange={(size) => change({ ...tile, [key]: Number(size) })}
        />
      ))}
      <View style={row}>
        <Action
          label={uiText('Move earlier')}
          secondary
          disabled={disabled || first}
          onPress={() => move(-1)}
        />
        <Action
          label={uiText('Move later')}
          secondary
          disabled={disabled || last}
          onPress={() => move(1)}
        />
        <Action label={uiText('Remove tile')} secondary disabled={disabled} onPress={remove} />
      </View>
    </View>
  )
}

function DisplayEditor({
  tile,
  change,
  compound,
  disabled,
}: {
  tile: Extract<DashboardTile, { kind: 'api' | 'cli' | 'mcp' }>
  change: (tile: DashboardTile) => void
  compound: boolean
  disabled: boolean
}) {
  const uiText = useInterfaceText()
  const { colors } = useTheme()
  const panels = tile.panels ?? []
  const options = Object.entries(dashboardDisplayLabels).map(([id, label]) => ({
    id,
    name: uiText(label),
  }))
  const changePanels = (next: StudioDataPanel[]) => {
    const { panels: _, ...single } = tile
    change(next.length ? { ...single, panels: next } : single)
  }
  return (
    <View style={{ gap: 8 }}>
      {panels.length === 0 && (
        <Choice
          label={uiText('Display')}
          value={tile.chart}
          items={options}
          disabled={disabled}
          onChange={(chart) => {
            if (isDashboardDisplay(chart)) change({ ...tile, chart })
          }}
        />
      )}
      {panels.map((panel, index) => {
        const update = (patch: Partial<StudioDataPanel>) =>
          changePanels(
            panels.map((item, position) => (position === index ? { ...item, ...patch } : item)),
          )
        return (
          <View
            key={index}
            style={{
              gap: 8,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
              padding: 8,
            }}
          >
            <Field
              label={uiText('Display title')}
              value={panel.title}
              maxLength={100}
              editable={!disabled}
              onChangeText={(title) => update({ title })}
            />
            <Field
              label={uiText('JSON pointer')}
              value={panel.pointer}
              editable={!disabled}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(pointer) => update({ pointer })}
            />
            <Choice
              label={uiText('Display')}
              value={panel.chart}
              items={options}
              disabled={disabled}
              onChange={(chart) => {
                if (isDashboardDisplay(chart)) update({ chart })
              }}
            />
            <Action
              label={uiText('Remove display')}
              secondary
              disabled={disabled}
              onPress={() => changePanels(panels.filter((_, position) => position !== index))}
            />
          </View>
        )
      })}
      {compound && (
        <Action
          label={uiText('Add display')}
          variant="outline"
          disabled={disabled || panels.length >= studioDataPanelLimit}
          onPress={() => {
            const chart = panels.length ? 'number' : tile.chart
            changePanels([
              ...panels,
              { title: uiText(dashboardDisplayLabels[chart]), chart, pointer: '' },
            ])
          }}
        />
      )}
    </View>
  )
}

function TileContent({ dashboard, tile }: { dashboard: Dashboard; tile: DashboardTile }) {
  const uiText = useInterfaceText()
  const { call, connected, snapshot, activeId } = useRuntime()
  const { navigate, focused } = useNavigation()
  const workspace = snapshot?.workspace
  const { colors } = useTheme()
  const state = useDashboardTile(call, dashboard, tile, connected, focused)
  const { data, terminalId, busy, error, pipelines } = state
  const [open, setOpen] = useState(false)
  const terminal = snapshot?.terminals.find((entry) => entry.id === terminalId)
  const project =
    tile.kind === 'command' || tile.kind === 'tui'
      ? (workspace?.repositories.find((entry) => entry.id === tile.repositoryId)?.name ??
        tile.repositoryId)
      : undefined

  if (isStudioDataSource(tile))
    return (
      <MobileDataSource source={tile} read={() => readDashboardDataSource(call, dashboard, tile)} />
    )
  if (tile.kind === 'extension')
    return (
      <MobileExtensionTile
        id={tile.extensionId}
        contributionId={tile.contributionId}
        visible={focused}
      />
    )
  const close = () => setOpen(false)
  const sessionId = tile.kind === 'terminal' ? tile.terminalId : terminalId
  return (
    <>
      {tile.kind === 'mcp' && (
        <>
          <Text selectable>{`${tile.server} · ${tile.tool}`}</Text>
          <Action
            label={busy ? uiText('Reading…') : uiText('Refresh data')}
            secondary
            disabled={!connected || busy}
            onPress={() => void state.refresh()}
          />
          {data && (
            <>
              <Text>
                {uiText('Updated {time}', { time: new Date(data.updatedAt).toLocaleTimeString() })}
              </Text>
              <DataView value={data.data} chart={tile.chart} panels={tile.panels} />
            </>
          )}
        </>
      )}
      {(tile.kind === 'command' || tile.kind === 'tui') && (
        <>
          <Text>{project}</Text>
          <Text selectable>{tile.command}</Text>
          <View style={row}>
            <Action
              label={
                busy
                  ? uiText('Working…')
                  : state.recovering
                    ? uiText('Recover run')
                    : uiText('Run command')
              }
              secondary
              disabled={
                !connected ||
                busy ||
                state.sessionLoading ||
                (!!terminalId && terminal?.exited !== true)
              }
              onPress={() => {
                const run = () => void state.run(() => setOpen(true))
                if (state.recovering) run()
                else
                  Alert.alert(uiText('Run this command in {project}?', { project }), tile.command, [
                    { text: uiText('Cancel'), style: 'cancel' },
                    { text: uiText('Run'), onPress: run },
                  ])
              }}
            />
            {terminalId && (
              <Action
                label={uiText('Close session')}
                secondary
                disabled={!connected || busy}
                onPress={() => void state.close()}
              />
            )}
          </View>
          {terminal?.exited && (
            <Text>
              {terminal.exitCode === undefined
                ? uiText('Exited')
                : uiText('Exited with code {code}', { code: terminal.exitCode })}
            </Text>
          )}
        </>
      )}
      {sessionId && (
        <Action label={uiText('Open terminal')} secondary onPress={() => setOpen(true)} />
      )}
      {sessionId && open && focused && (
        <SafeModal visible onRequestClose={close}>
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <ScreenHeader title={tile.title} onBack={close} />
            <View style={{ flex: 1 }}>
              <TerminalSession id={sessionId} readOnly={tile.kind === 'command'} />
            </View>
          </View>
        </SafeModal>
      )}
      {tile.kind === 'iframe' && (
        <>
          <Text selectable>{tile.url}</Text>
          <Action label={uiText('Open embed')} secondary onPress={() => setOpen(true)} />
          {open && focused && (
            <SafeModal visible onRequestClose={close}>
              <View style={{ flex: 1, backgroundColor: colors.background }}>
                <ScreenHeader title={tile.title} onBack={close} />
                <WebView
                  source={{
                    html:
                      '<meta name="viewport" content="width=device-width,initial-scale=1"><iframe referrerpolicy="no-referrer" sandbox="allow-scripts allow-forms" style="position:fixed;inset:0;width:100%;height:100%;border:0" src="' +
                      tile.url
                        .replaceAll('&', '&amp;')
                        .replaceAll('"', '&quot;')
                        .replaceAll('<', '&lt;') +
                      '"></iframe>',
                  }}
                  originWhitelist={['*']}
                  allowFileAccess={false}
                  sharedCookiesEnabled={false}
                  javaScriptCanOpenWindowsAutomatically={false}
                  onShouldStartLoadWithRequest={(entry) =>
                    !entry.isTopFrame || entry.url === 'about:blank'
                  }
                />
              </View>
            </SafeModal>
          )}
        </>
      )}
      {tile.kind === 'browser' && (
        <>
          <Text selectable>{tile.url}</Text>
          <Action
            label={uiText('Open browser tile')}
            secondary
            disabled={!connected}
            onPress={() => setOpen(true)}
          />
          {open && focused && (
            <SafeModal visible onRequestClose={close}>
              <View style={{ flex: 1, backgroundColor: colors.background }}>
                <ScreenHeader title={tile.title} onBack={close} />
                <RemoteBrowser
                  taskId={STUDIO_BROWSER_SCOPE}
                  tabId={`dashboard-${dashboard.id}-${tile.id}`}
                  initialUrl={tile.url}
                  expanded
                />
              </View>
            </SafeModal>
          )}
        </>
      )}
      {tile.kind === 'app' && (
        <>
          <Action
            label={uiText('Open MCP App')}
            secondary
            disabled={!connected}
            onPress={() => setOpen(true)}
          />
          {open && focused && (
            <McpAppView
              visible
              reference={{ id: tile.appId, taskId: tile.taskId, title: tile.title }}
            />
          )}
        </>
      )}
      {tile.kind === 'gui' && (
        <>
          <Action
            label={uiText('Open remote desktop')}
            secondary
            disabled={!snapshot?.remoteDesktopEnabled}
            onPress={() => setOpen(true)}
          />
          {open && focused && <MobileRemoteDesktop onClose={close} />}
        </>
      )}
      {tile.kind === 'pipelines' && (
        <>
          <Action
            label={uiText('Refresh pipelines')}
            secondary
            disabled={!connected || busy}
            onPress={() => void state.refreshPipelines()}
          />
          {pipelines?.refreshError && <Text>{pipelines.refreshError}</Text>}
          {pipelines?.items.slice(0, 8).map((run) => (
            <Action
              key={run.id}
              label={`${run.title} · ${run.status}`}
              secondary
              onPress={() => {
                if (activeId)
                  router.navigate(pipelineHref(activeId, tile.repositoryId, run.id, run.url), {
                    withAnchor: true,
                  })
              }}
            />
          ))}
          {pipelines?.items.length === 0 && <Text>{uiText('No pipelines found.')}</Text>}
        </>
      )}
      {tile.kind === 'jobs' && (
        <>
          <Action label={uiText('Open automations')} secondary onPress={() => navigate('jobs')} />
          {workspace?.automations.slice(0, 8).map((entry) => (
            <Action
              key={entry.id}
              label={entry.name}
              secondary
              onPress={() => {
                if (activeId)
                  router.navigate(automationHref(activeId, entry.id), { withAnchor: true })
              }}
            />
          ))}
        </>
      )}
      {tile.kind === 'threads' &&
        workspace?.tasks
          .slice(0, 8)
          .map((entry) => (
            <Action
              key={entry.id}
              label={entry.title}
              secondary
              onPress={() => navigate('tasks', entry.id, activeId ?? undefined)}
            />
          ))}
      {error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      )}
    </>
  )
}
