import { projectDisplayName, runtimeComputerName } from '@dovo/protocol'
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import {
  settingsProjectChoices,
  resolveSettingsTarget,
  settingsScopeSummary,
  type SettingsTarget,
  type SettingsScope,
  type Repository,
} from '@dovo/protocol'
import { useApplicationState } from '../state/application-state'
import { RuntimeScope, useRuntime } from '../connection/provider'
import { SettingsChoice as Choice } from '../../screens/settings-controls'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

const Context = createContext<{
  target: SettingsTarget
  setTarget: (target: SettingsTarget) => void
  registerDraft: (id: symbol, dirty: boolean, saving: boolean) => () => void
} | null>(null)
export function SettingsTargetProvider({ children }: { children: ReactNode }) {
  const [target, updateTarget] = useApplicationState<SettingsTarget>({
    environmentId: '',
    projectId: '',
  })
  const drafts = useRef(new Map<symbol, { dirty: boolean; saving: boolean }>())
  const registerDraft = useCallback((id: symbol, dirty: boolean, saving: boolean) => {
    drafts.current.set(id, { dirty, saving })
    return () => {
      drafts.current.delete(id)
    }
  }, [])
  const setTarget = (next: SettingsTarget) => {
    if (next.environmentId === target.environmentId && next.projectId === target.projectId) return
    const values = [...drafts.current.values()]
    if (values.some((draft) => draft.saving)) return
    if (!values.some((draft) => draft.dirty)) updateTarget(next)
    else
      Alert.alert('Unsaved settings', 'Discard unsaved settings changes?', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => updateTarget(next) },
      ])
  }
  return (
    <Context.Provider value={{ target, setTarget, registerDraft }}>{children}</Context.Provider>
  )
}
export function useSettingsDraft(dirty: boolean, saving = false) {
  const context = useContext(Context)
  const id = useRef(Symbol('settings-draft'))
  useEffect(
    () => context?.registerDraft(id.current, dirty, saving),
    [context?.registerDraft, dirty, saving],
  )
}
/** Scoped controls can also render outside the settings screens, where there is no target to move. */
export function useOptionalSettingsTarget() {
  const context = useContext(Context)
  return context ? { target: context.target, setTarget: context.setTarget } : null
}
/** The shared target with its resolved level, computer and project, for summaries. */
function useSettingsTargetState() {
  const context = useContext(Context)
  if (!context) throw new Error('SettingsTargetProvider is required')
  const { overviews, activeId } = useRuntime()
  const resolved = resolveSettingsTarget(overviews, context.target, activeId)
  return {
    ...context,
    ...resolved,
    projectName: projectDisplayName(
      resolved.repository,
      context.target.projectId ? 'Unavailable project' : 'All projects',
    ),
    computerName: context.target.environmentId
      ? resolved.source
        ? runtimeComputerName(resolved.source)
        : 'Unavailable computer'
      : 'All machines',
  }
}
/** The target bar above scoped pages, like T3 Code's "Applying settings for". */
export function ScopedSettings({
  children,
  scrollable = false,
}: {
  children: (selection: { scope: SettingsScope; repository?: Repository }) => ReactNode
  scrollable?: boolean
}) {
  const { colors, styles } = useTheme()
  const { target, setTarget, source, scope, repository, projectName, computerName } =
    useSettingsTargetState()
  const { overviews } = useRuntime()
  const projects = settingsProjectChoices(overviews, target.environmentId)
  const summary = settingsScopeSummary(scope, { project: projectName, computer: computerName })
  const content = [
    <View
      key="target"
      accessibilityLabel="Settings target"
      style={[
        styles.card,
        { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface },
      ]}
    >
      <Text style={[styles.text, { fontWeight: '600' }]}>Editing {summary.title}</Text>
    </View>,
    <View key="choices" accessibilityLabel="Settings choices" style={[styles.card, { gap: 12 }]}>
      <Text style={[styles.text, { fontWeight: '600' }]}>{summary.storage}</Text>
      <Text style={[styles.muted, { fontSize: 13, lineHeight: 18 }]}>{summary.description}</Text>
      <Choice
        label="Project"
        row
        value={target.projectId}
        items={[
          { id: '', name: 'All projects' },
          ...(target.projectId && !projects.some((project) => project.id === target.projectId)
            ? [{ id: target.projectId, name: 'Project unavailable' }]
            : []),
          ...projects,
        ]}
        onChange={(projectId) => setTarget({ ...target, projectId })}
      />
      <Choice
        label="Machine"
        row
        value={target.environmentId}
        items={[
          { id: '', name: 'All machines' },
          ...(target.environmentId &&
          !overviews.some((entry) => entry.profile.id === target.environmentId)
            ? [{ id: target.environmentId, name: 'Computer unavailable' }]
            : []),
          ...overviews.map((entry) => ({
            id: entry.profile.id,
            name: `${runtimeComputerName(entry)}${entry.connected ? '' : ' · Offline'}`,
          })),
        ]}
        onChange={(environmentId) => setTarget({ ...target, environmentId })}
      />
    </View>,
    <View key="settings" style={{ gap: 28 }}>
      {!source ? (
        <Text style={[styles.muted, { padding: 16 }]}>
          {overviews.length
            ? 'This project is not available on the selected computer. Choose another target.'
            : 'Connect a computer to configure defaults and project tools.'}
        </Text>
      ) : (
        <RuntimeScope
          key={`${source.profile.id}:${scope}:${repository?.id ?? ''}`}
          runtimeId={source.profile.id}
        >
          {!source.connected && (
            <Text style={[styles.muted, { paddingHorizontal: 16 }]}>
              This computer is offline. Reconnect to make changes.
            </Text>
          )}
          {children({ scope, repository })}
        </RuntimeScope>
      )}
    </View>,
  ]
  return scrollable ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      stickyHeaderIndices={[0]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
    >
      {content}
    </ScrollView>
  ) : (
    <View style={{ gap: 28 }}>{content}</View>
  )
}
