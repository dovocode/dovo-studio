import { DataView } from './dashboard-data-view'
import { MobileExtensionTile } from './studio-extensions'
import { useState } from 'react'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { Alert, ScrollView, View } from 'react-native'
import WebView from 'react-native-webview'
import {
  STUDIO_BROWSER_SCOPE,
  runtimeComputerName,
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
import { McpAppView } from '../ui/content/mcp-app'
import { RemoteBrowser } from '../tasks/preview/remote-browser'
import { Text } from '../ui/content/text'
import { SafeModal } from '../ui/layout/safe-modal'
import { ScreenHeader } from '../ui/layout/screen-header'
import { useTheme } from '../ui/theme'
import { MobileRemoteDesktop } from './remote-desktop'

const tileKinds = Object.keys(dashboardTileLabels).filter((kind): kind is DashboardTile['kind'] =>
  Object.hasOwn(dashboardTileLabels, kind),
)
const row = { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as const

export default function DashboardsScreen() {
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
      <ScreenHeader title="Dashboards" onBack={() => navigate('tasks')} />
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
        <Text>Connect a computer with dashboard support.</Text>
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
  const { read, connected, readCache, snapshot } = useRuntime()
  const { focused } = useNavigation()
  const { colors } = useTheme()
  const state = useDashboards(read, connected, readCache, focused)
  const { dashboard, draft } = state
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
  const availableKinds = tileKinds.filter((kind) => kind !== 'extension' || supported)

  const [kind, setKind] = useState<DashboardTile['kind']>('api')
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
        throw new Error('Choose a dashboard file of 1 MB or less.')
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
    state.edit(imported)
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
      <Choice
        label="Computer"
        value={owner}
        items={computers}
        onChange={setOwner}
        disabled={!!draft || state.pending || fileBusy}
      />
      {state.dashboards.length > 0 && (
        <Choice
          label="Dashboard"
          value={dashboard?.id ?? ''}
          items={state.dashboards.map((item) => ({ id: item.id, name: item.title }))}
          onChange={state.select}
          disabled={!!draft || state.pending || fileBusy}
        />
      )}
      {!connected && (
        <Text accessibilityRole="alert">Computer offline. Save your edits when it reconnects.</Text>
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
              label="Save dashboard"
              disabled={!connected || state.pending}
              onPress={() => void state.save()}
            />
            {draft.revision > 0 && state.error && (
              <Action
                label="Keep as new dashboard"
                secondary
                disabled={state.pending}
                onPress={state.copyDraft}
              />
            )}
            <Action
              label="Cancel edits"
              secondary
              disabled={state.pending}
              onPress={() => state.edit(undefined)}
            />
          </>
        ) : (
          <>
            <Action
              label="New dashboard"
              disabled={state.pending || fileBusy}
              onPress={state.create}
            />
            <Action
              label="Import dashboard"
              secondary
              disabled={state.pending || fileBusy}
              onPress={() => void importFile()}
            />
            <Action
              label="Paste template"
              secondary
              disabled={state.pending || fileBusy}
              onPress={() => {
                setTemplate('')
                setTemplateError('')
              }}
            />
            {dashboard && (
              <>
                <Action
                  label="Edit dashboard"
                  secondary
                  disabled={state.pending || fileBusy}
                  onPress={() => state.edit(dashboard)}
                />
                <Action
                  label="Export dashboard"
                  secondary
                  disabled={fileBusy}
                  onPress={() => void exportFile(dashboard)}
                />
                <Action
                  label="View template"
                  secondary
                  disabled={fileBusy}
                  onPress={() => {
                    setTemplate(dashboardTemplate(dashboard))
                    setTemplateError('')
                  }}
                />
                <Action
                  label="Delete dashboard"
                  secondary
                  disabled={!connected || state.pending || fileBusy}
                  onPress={() => {
                    Alert.alert('Delete dashboard?', dashboard.title, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => void state.remove() },
                    ])
                  }}
                />
              </>
            )}
            <Action
              label="Reload"
              secondary
              disabled={!connected || state.pending}
              onPress={() => void state.load()}
            />
          </>
        )}
      </View>
      {!draft && template !== undefined && (
        <>
          <Field
            label="Dashboard template (JSON)"
            value={template}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTemplate}
          />
          <View style={row}>
            <Action
              label="Open as draft"
              secondary
              disabled={!template.trim() || fileBusy}
              onPress={importTemplate}
            />
            <Action label="Close template" secondary onPress={() => setTemplate(undefined)} />
          </View>
        </>
      )}
      {templateError && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {templateError}
        </Text>
      )}
      {draft && draft.id === importedId && (
        <Text>Review the imported tiles and bind sources on this computer before you save.</Text>
      )}
      {draft ? (
        <>
          <Field
            label="Dashboard title"
            maxLength={100}
            value={draft.title}
            editable={!state.pending}
            onChangeText={(title) => state.edit({ ...draft, title })}
          />
          <Choice
            label="Tile type"
            value={kind}
            items={availableKinds.map((id) => ({ id, name: dashboardTileLabels[id] }))}
            disabled={state.pending}
            onChange={(id) => {
              const match = tileKinds.find((entry) => entry === id)
              if (match) setKind(match)
            }}
          />
          <Action
            label="Add tile"
            secondary
            disabled={state.pending || draft.tiles.length >= 32}
            onPress={() =>
              state.edit({ ...draft, tiles: [...draft.tiles, newDashboardTile(kind)] })
            }
          />
          {draft.tiles.map((tile, index) => (
            <TileEditor
              key={tile.id}
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
              remove={() =>
                state.edit({ ...draft, tiles: draft.tiles.filter((entry) => entry.id !== tile.id) })
              }
            />
          ))}
        </>
      ) : (
        dashboard?.tiles.map((tile) => (
          <View
            key={`${dashboard.id}:${tile.id}:${dashboard.revision}`}
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
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
  const { snapshot } = useRuntime()
  const workspace = snapshot?.workspace
  const { colors } = useTheme()
  return (
    <View
      style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12, gap: 8 }}
    >
      <Text accessibilityRole="header">{dashboardTileLabels[tile.kind]}</Text>
      <Field
        label="Tile title"
        value={tile.title}
        maxLength={100}
        editable={!disabled}
        onChangeText={(title) => change({ ...tile, title })}
      />
      {tile.kind === 'extension' && (
        <Choice
          label="Extension contribution"
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
              ? workspace?.repositories.map((item) => ({ id: item.id, name: item.name }))
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
              label={label}
              items={items}
              value={value}
              disabled={disabled}
              onChange={update}
            />
          ) : (
            <Field
              key={key}
              label={label}
              value={value}
              editable={!disabled}
              autoCapitalize="none"
              autoCorrect={false}
              multiline={key === 'command' || key === 'arguments'}
              onChangeText={update}
            />
          )
        })}
      {(tile.kind === 'api' || tile.kind === 'mcp') && (
        <Choice
          label="Display"
          value={tile.chart}
          disabled={disabled}
          items={[
            { id: 'table', name: 'Table' },
            { id: 'line', name: 'Line graph' },
            { id: 'number', name: 'Metric' },
          ]}
          onChange={(chart) => {
            if (chart === 'table' || chart === 'line' || chart === 'number')
              change({ ...tile, chart })
          }}
        />
      )}
      {(['span', 'height'] as const).map((key) => (
        <Choice
          key={key}
          label={key === 'span' ? 'Desktop width' : 'Desktop height'}
          value={String(tile[key])}
          disabled={disabled}
          items={['1', '2', '3', '4'].map((id) => ({ id, name: id }))}
          onChange={(size) => change({ ...tile, [key]: Number(size) })}
        />
      ))}
      <View style={row}>
        <Action
          label="Move earlier"
          secondary
          disabled={disabled || first}
          onPress={() => move(-1)}
        />
        <Action label="Move later" secondary disabled={disabled || last} onPress={() => move(1)} />
        <Action label="Remove tile" secondary disabled={disabled} onPress={remove} />
      </View>
    </View>
  )
}

function TileContent({ dashboard, tile }: { dashboard: Dashboard; tile: DashboardTile }) {
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
      {(tile.kind === 'api' || tile.kind === 'mcp') && (
        <>
          <Text selectable>{tile.kind === 'api' ? tile.url : `${tile.server} · ${tile.tool}`}</Text>
          <Action
            label={busy ? 'Reading…' : 'Refresh data'}
            secondary
            disabled={!connected || busy}
            onPress={() => void state.refresh()}
          />
          {data && (
            <>
              <Text>Updated {new Date(data.updatedAt).toLocaleTimeString()}</Text>
              <DataView value={data.data} chart={tile.chart} />
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
              label={busy ? 'Working…' : state.recovering ? 'Recover run' : 'Run command'}
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
                  Alert.alert(`Run this command in ${project}?`, tile.command, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Run', onPress: run },
                  ])
              }}
            />
            {terminalId && (
              <Action
                label="Close session"
                secondary
                disabled={!connected || busy}
                onPress={() => void state.close()}
              />
            )}
          </View>
          {terminal?.exited && (
            <Text>
              Exited{terminal.exitCode === undefined ? '' : ` with code ${terminal.exitCode}`}
            </Text>
          )}
        </>
      )}
      {sessionId && <Action label="Open terminal" secondary onPress={() => setOpen(true)} />}
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
          <Action label="Open embed" secondary onPress={() => setOpen(true)} />
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
            label="Open browser tile"
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
            label="Open MCP App"
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
            label="Open remote desktop"
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
            label="Refresh pipelines"
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
          {pipelines?.items.length === 0 && <Text>No pipelines found.</Text>}
        </>
      )}
      {tile.kind === 'jobs' && (
        <>
          <Action label="Open automations" secondary onPress={() => navigate('jobs')} />
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
