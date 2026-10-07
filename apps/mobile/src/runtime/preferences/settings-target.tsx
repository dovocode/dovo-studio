import { runtimeComputerName } from '@dovo/protocol'
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import { Alert, Pressable, View } from 'react-native'
import {
  settingsProjectChoices,
  resolveSettingsTarget,
  settingsScopeLabels,
  settingsScopes,
  settingsScopeDescriptions,
  settingsTargetAtScope,
  type SettingsTarget,
  type SettingsScope,
  type Repository,
} from '@dovo/protocol'
import { useApplicationState } from '../state/application-state'
import { RuntimeScope, useRuntime } from '../connection/provider'
import { Choice } from '../../ui/controls/choice'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
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
export function useSettingsTargetState() {
  const context = useContext(Context)
  if (!context) throw new Error('SettingsTargetProvider is required')
  const { overviews, activeId } = useRuntime()
  const resolved = resolveSettingsTarget(overviews, context.target, activeId)
  return {
    ...context,
    ...resolved,
    projectName:
      resolved.repository?.name ??
      (context.target.projectId ? 'Unavailable project' : 'All projects'),
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
}: {
  children: (selection: { scope: SettingsScope; repository?: Repository }) => ReactNode
}) {
  const { colors, styles } = useTheme()
  const { target, setTarget, source, scope, repository, projectName, computerName } =
    useSettingsTargetState()
  const { overviews, activeId } = useRuntime()
  const projects = settingsProjectChoices(overviews, target.environmentId)
  const [expanded, setExpanded] = useApplicationState(false)
  const selectedIndex = settingsScopes.indexOf(scope)
  return (
    <View style={{ flex: 1, gap: 12 }}>
      <View
        accessibilityLabel="Settings target"
        style={[styles.card, { gap: 10, marginHorizontal: 12 }]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.muted, { flex: 1, fontSize: 13, lineHeight: 18 }]}>
            Applying settings for{' '}
            <Text style={{ color: colors.text, fontWeight: '600' }}>{projectName}</Text>
            {' on '}
            <Text style={{ color: colors.text, fontWeight: '600' }}>{computerName}</Text>
          </Text>
          <Action
            secondary
            label={expanded ? 'Hide scope choices' : 'Change scope'}
            onPress={() => setExpanded(!expanded)}
          />
        </View>
        <View
          accessibilityLabel="Settings inheritance"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}
        >
          {settingsScopes.map((level, index) => {
            const next = settingsTargetAtScope(overviews, target, level, activeId)
            const selected = scope === level
            const passed = index < selectedIndex
            return (
              <Pressable
                key={level}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${settingsScopeLabels[level]} settings`}
                accessibilityHint={settingsScopeDescriptions[level]}
                accessibilityState={{ selected, disabled: !next }}
                disabled={!next}
                onPress={() => next && setTarget(next)}
                style={({ pressed }) => ({
                  width: expanded ? '48%' : undefined,
                  flexGrow: expanded ? 1 : 0,
                  gap: 4,
                  paddingHorizontal: 10,
                  paddingVertical: expanded ? 10 : 7,
                  minHeight: expanded ? 76 : 34,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: selected ? colors.accent : colors.border,
                  backgroundColor: selected || pressed ? colors.selection : undefined,
                  opacity: next ? 1 : 0.4,
                })}
              >
                <Text
                  style={[
                    styles.text,
                    {
                      fontSize: 12,
                      fontWeight: '600',
                      color: selected ? colors.accent : passed ? colors.text : colors.muted,
                    },
                  ]}
                >
                  {index + 1} · {settingsScopeLabels[level]}
                </Text>
                {expanded && (
                  <Text style={[styles.muted, { fontSize: 11, lineHeight: 15 }]}>
                    {settingsScopeDescriptions[level]}
                  </Text>
                )}
              </Pressable>
            )
          })}
        </View>
        {expanded && (
          <>
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
              label="Computer"
              row
              value={target.environmentId}
              items={[
                { id: '', name: 'All computers · shared' },
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
          </>
        )}
        <Text style={[styles.muted, { fontSize: 12, lineHeight: 17 }]}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>
            Editing {settingsScopeLabels[scope]}.
          </Text>{' '}
          Later levels override earlier ones; each setting shows its source and which later levels
          override it.
          {!target.environmentId ? ' Shared defaults sync to paired computers.' : ''}
        </Text>
      </View>
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
    </View>
  )
}
