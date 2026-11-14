import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { Icon } from '../../ui/controls/icon'
import { SettingsScrollView } from '../../screens/settings-search'
import { projectDisplayName, runtimeComputerName } from '@dovo/protocol'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Alert, Pressable, View } from 'react-native'
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
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { ProjectOrganizationSettings } from '../../scm/connections/project-organization'

const Context = createContext<{
  draftFlags: number
  confirmNavigation: (proceed: () => void) => void
  target: SettingsTarget
  setTarget: (target: SettingsTarget) => void
  registerDraft: (id: symbol, dirty: boolean, saving: boolean) => () => void
} | null>(null)
export function SettingsTargetProvider({ children }: { children: ReactNode }) {
  const uiText = useInterfaceText()

  const [target, updateTarget] = useApplicationState<SettingsTarget>({
    environmentId: '',
    projectId: '',
  })
  const drafts = useRef(new Map<symbol, { dirty: boolean; saving: boolean }>())
  const [draftFlags, setDraftFlags] = useState(0)
  const notifyDrafts = useCallback(() => {
    const values = [...drafts.current.values()]
    setDraftFlags(
      (values.some((draft) => draft.dirty) ? 1 : 0) |
        (values.some((draft) => draft.saving) ? 2 : 0),
    )
  }, [])
  const registerDraft = useCallback(
    (id: symbol, dirty: boolean, saving: boolean) => {
      drafts.current.set(id, { dirty, saving })
      notifyDrafts()
      return () => {
        drafts.current.delete(id)
        notifyDrafts()
      }
    },
    [notifyDrafts],
  )
  const confirmNavigation = (proceed: () => void) => {
    const values = [...drafts.current.values()]
    if (values.some((draft) => draft.saving)) return
    if (!values.some((draft) => draft.dirty)) proceed()
    else
      Alert.alert(uiText('Unsaved settings'), uiText('Discard unsaved settings changes?'), [
        { text: uiText('Keep editing'), style: 'cancel' },
        { text: uiText('Discard'), style: 'destructive', onPress: proceed },
      ])
  }
  const setTarget = (next: SettingsTarget) => {
    if (next.environmentId === target.environmentId && next.projectId === target.projectId) return
    confirmNavigation(() => updateTarget(next))
  }
  return (
    <Context.Provider value={{ target, setTarget, registerDraft, draftFlags, confirmNavigation }}>
      {children}
    </Context.Provider>
  )
}
export function useSettingsDraftState() {
  return useContext(Context)?.draftFlags ?? 0
}
export function useConfirmSettingsNavigation() {
  return useContext(Context)?.confirmNavigation ?? ((proceed: () => void) => proceed())
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
      : 'All computers',
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
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const [headerHeight, setHeaderHeight] = useState(0)
  const { target, setTarget, source, scope, repository, projectName, computerName } =
    useSettingsTargetState()
  const { overviews } = useRuntime()
  const projects = settingsProjectChoices(overviews, target.environmentId)
  const summary = settingsScopeSummary(scope, { project: projectName, computer: computerName })
  const content = [
    <View
      key="target"
      onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
      accessibilityLabel={uiText('Settings target')}
      style={[
        styles.card,
        { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[styles.text, { fontWeight: '600', flex: 1 }]}>{summary.title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={uiText('Settings inheritance details')}
          onPress={() => Alert.alert(summary.title, `${summary.description}\n\n${summary.storage}`)}
          style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="stack" size={18} color={colors.muted} />
        </Pressable>
      </View>
      {source && !source.connected && (
        <Text style={styles.muted}>
          <InterfaceText>{'Offline · edits kept here'}</InterfaceText>
        </Text>
      )}
    </View>,
    <View
      key="choices"
      accessibilityLabel={uiText('Settings choices')}
      style={[styles.card, { gap: 8 }]}
    >
      <Choice
        label={uiText('Project')}
        row
        value={target.projectId}
        items={[
          { id: '', name: uiText('All projects') },
          ...(target.projectId && !projects.some((project) => project.id === target.projectId)
            ? [{ id: target.projectId, name: uiText('Project unavailable') }]
            : []),
          ...projects.map((project) => ({
            id: project.id,
            name: project.archived ? `${project.name} · Archived` : project.name,
          })),
        ]}
        onChange={(projectId) => setTarget({ ...target, projectId })}
      />
      {overviews.length > 1 && (
        <Choice
          label={uiText('Computer')}
          row
          value={target.environmentId}
          items={[
            { id: '', name: uiText('All computers') },
            ...(target.environmentId &&
            !overviews.some((entry) => entry.profile.id === target.environmentId)
              ? [{ id: target.environmentId, name: uiText('Computer unavailable') }]
              : []),
            ...overviews.map((entry) => ({
              id: entry.profile.id,
              name: `${runtimeComputerName(entry)}${entry.connected ? '' : ' · Offline'}`,
            })),
          ]}
          onChange={(environmentId) => setTarget({ ...target, environmentId })}
        />
      )}
      {overviews.length === 1 && (
        <Action
          secondary
          label={
            target.environmentId
              ? uiText('Edit shared defaults')
              : uiText('Edit computer overrides')
          }
          onPress={() => {
            const environmentId = target.environmentId ? '' : overviews[0].profile.id
            const choices = settingsProjectChoices(overviews, environmentId)
            setTarget({
              environmentId,
              projectId: choices.some((project) => project.id === target.projectId)
                ? target.projectId
                : '',
            })
          }}
        />
      )}
    </View>,
    <View key="settings" style={{ gap: 28 }}>
      {!source ? (
        <Text style={[styles.muted, { padding: 16 }]}>
          {overviews.length
            ? uiText(
                'This project is not available on the selected computer. Choose another target.',
              )
            : uiText('Connect a computer to configure defaults and project tools.')}
        </Text>
      ) : (
        <RuntimeScope
          key={`${source.profile.id}:${scope}:${repository?.id ?? ''}`}
          runtimeId={source.profile.id}
        >
          {!source.connected && (
            <Text style={[styles.muted, { paddingHorizontal: 16 }]}>
              <InterfaceText>
                {'This computer is offline. Reconnect to make changes.'}
              </InterfaceText>
            </Text>
          )}
          {repository && <ProjectOrganizationSettings repository={repository} compact />}
          {children({ scope, repository })}
        </RuntimeScope>
      )}
    </View>,
  ]
  return scrollable ? (
    <SettingsScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      stickyHeaderIndices={[0]}
      searchHeaderHeight={headerHeight}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
    >
      {content}
    </SettingsScrollView>
  ) : (
    <View style={{ gap: 20 }}>{content}</View>
  )
}
