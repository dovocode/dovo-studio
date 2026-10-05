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
export function ScopedSettings({
  children,
}: {
  children: (selection: { scope: SettingsScope; repository?: Repository }) => ReactNode
}) {
  const { colors, styles } = useTheme()

  const context = useContext(Context)
  if (!context) throw new Error('SettingsTargetProvider is required')
  const { target, setTarget } = context
  const { overviews, activeId } = useRuntime()
  const { source, scope, repository } = resolveSettingsTarget(overviews, target, activeId)
  const projects = settingsProjectChoices(overviews, target.environmentId)
  const [expanded, setExpanded] = useApplicationState(false)
  return (
    <View style={{ flex: 1, gap: 12 }}>
      <View style={[styles.card, { gap: 12, marginHorizontal: 12 }]}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Text style={[styles.text, { fontSize: 14, fontWeight: '600' }]}>Settings scope</Text>
          <Action
            secondary
            label={expanded ? 'Hide scope choices' : 'Change scope'}
            onPress={() => setExpanded(!expanded)}
          />
        </View>
        <View
          accessibilityLabel="Settings inheritance"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
        >
          {settingsScopes.map((level, index) => {
            const next = settingsTargetAtScope(overviews, target, level, activeId)
            const selected = scope === level
            return (
              <Pressable
                key={level}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${settingsScopeLabels[level]} settings`}
                accessibilityState={{ selected, disabled: !next }}
                disabled={!next}
                onPress={() => next && setTarget(next)}
                style={({ pressed }) => ({
                  width: '48%',
                  flexGrow: 1,
                  gap: 4,
                  padding: 10,
                  minHeight: expanded ? 76 : 40,
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
                      fontSize: 13,
                      fontWeight: '600',
                      color: selected ? colors.accent : colors.text,
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
            Editing {settingsScopeLabels[scope]} defaults.
          </Text>{' '}
          {target.environmentId ? runtimeComputerName(source ?? {}) : 'All computers'}
          {repository ? ` · ${repository.name}` : ' · All projects'}. Later levels override earlier
          ones. Inherit or reset to use an earlier value.
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
