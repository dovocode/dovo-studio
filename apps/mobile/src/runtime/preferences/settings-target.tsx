import { createContext, useContext, type ReactNode } from 'react'
import { View } from 'react-native'
import {
  settingsProjectChoices,
  resolveSettingsTarget,
  settingsScopeLabels,
  type SettingsTarget,
  type SettingsScope,
  type Repository,
} from '@dovo/protocol'
import { useApplicationState } from '../state/application-state'
import { RuntimeScope, useRuntime } from '../connection/provider'
import { Choice } from '../../ui/controls/choice'
import { Text } from '../../ui/content/text'
import { styles } from '../../ui/theme'

const Context = createContext<{
  target: SettingsTarget
  setTarget: (target: SettingsTarget) => void
} | null>(null)
export function SettingsTargetProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useApplicationState<SettingsTarget>({
    environmentId: '',
    projectId: '',
  })
  return <Context.Provider value={{ target, setTarget }}>{children}</Context.Provider>
}
export function ScopedSettings({
  children,
}: {
  children: (selection: { scope: SettingsScope; repository?: Repository }) => ReactNode
}) {
  const context = useContext(Context)
  if (!context) throw new Error('SettingsTargetProvider is required')
  const { target, setTarget } = context
  const { overviews, activeId } = useRuntime()
  const { source, scope, repository } = resolveSettingsTarget(overviews, target, activeId)
  const projects = settingsProjectChoices(overviews, target.environmentId)
  return (
    <View style={{ flex: 1, gap: 12 }}>
      <View style={[styles.card, { gap: 8, marginHorizontal: 12 }]}>
        <Text style={styles.muted}>Applying settings · {settingsScopeLabels[scope]}</Text>
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
          label="Environment"
          row
          value={target.environmentId}
          items={[
            { id: '', name: 'Shared across environments' },
            ...(target.environmentId &&
            !overviews.some((entry) => entry.profile.id === target.environmentId)
              ? [{ id: target.environmentId, name: 'Environment unavailable' }]
              : []),
            ...overviews.map((entry) => ({
              id: entry.profile.id,
              name: `${entry.profile.name === new URL(entry.profile.connection.address).hostname ? (entry.snapshot?.runtimeHost ?? entry.profile.name) : entry.profile.name}${entry.connected ? '' : ' · Offline'}`,
            })),
          ]}
          onChange={(environmentId) => setTarget({ ...target, environmentId })}
        />
        <Text style={styles.muted}>
          {target.environmentId
            ? 'Overrides on this environment.'
            : 'Shared settings sync to connected computers.'}{' '}
          Unset values inherit earlier levels.
        </Text>
      </View>
      {!source ? (
        <Text style={[styles.muted, { padding: 16 }]}>
          {overviews.length
            ? 'This project is not available on the selected environment. Choose another target.'
            : 'Connect a computer to configure defaults and project tools.'}
        </Text>
      ) : (
        <RuntimeScope
          key={`${source.profile.id}:${scope}:${repository?.id ?? ''}`}
          runtimeId={source.profile.id}
        >
          {!source.connected && (
            <Text style={[styles.muted, { paddingHorizontal: 16 }]}>
              This environment is offline. Reconnect to make changes.
            </Text>
          )}
          {children({ scope, repository })}
        </RuntimeScope>
      )}
    </View>
  )
}
