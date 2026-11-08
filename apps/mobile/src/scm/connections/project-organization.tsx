import { View } from 'react-native'
import {
  projectOrganizationBlocked,
  projectOrganizationSave,
  projectOrganizationScope,
  scopedSettingsResultSchema,
  sharedProjectKey,
  type ProjectOrganizationChange,
  type Repository,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'
import { SettingsAction as Action } from '../../screens/settings-controls'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

/** Pin and archive one project; archived projects stay reachable here to unarchive. */
export function ProjectOrganizationSettings({
  repository,
  compact = false,
}: {
  repository: Repository
  /** Only offer Unarchive, for settings screens targeting an archived project. */
  compact?: boolean
}) {
  const { styles } = useTheme()
  const { call, refresh, connected, snapshot } = useRuntime()
  const { busy, error, act } = useAction()
  const blocked = projectOrganizationBlocked(repository, snapshot?.projectOrganizationSupported)
  const disabled = !connected || busy || !!blocked
  const save = (change: ProjectOrganizationChange) =>
    act(async () => {
      const current = await call(
        '/api/agents/settings/read',
        projectOrganizationScope(repository),
        scopedSettingsResultSchema,
      )
      await call(
        '/api/agents/settings/save',
        projectOrganizationSave(repository, current.value, change),
        scopedSettingsResultSchema,
      )
      await refresh()
    })
  const archive = (
    <Action
      secondary
      label={repository.archived ? 'Unarchive project' : 'Archive project'}
      disabled={disabled}
      onPress={() => save({ projectArchived: !repository.archived })}
    />
  )
  const feedback = (
    <>
      {!!blocked && <Text style={styles.muted}>{blocked}</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </>
  )
  if (compact)
    return repository.archived ? (
      <View style={{ gap: 8, paddingHorizontal: 16 }}>
        <Text style={styles.muted}>Archived · hidden from new-thread project choices.</Text>
        {archive}
        {feedback}
      </View>
    ) : null
  return (
    <View accessibilityLabel="Project organization" style={{ gap: 8 }}>
      <Text style={styles.text}>Organize</Text>
      <Text style={styles.muted}>
        Pinned projects come first in project pickers. Archived projects leave new-thread project
        choices; their threads, settings and files are kept.{' '}
        {sharedProjectKey(repository)
          ? 'Syncs across paired computers with the same Git remote.'
          : 'Applies to this project on this computer.'}
      </Text>
      <View style={styles.row}>
        <Action
          secondary
          label={repository.pinned ? 'Unpin project' : 'Pin project'}
          disabled={disabled}
          onPress={() => save({ projectPinned: !repository.pinned })}
        />
        {archive}
      </View>
      {feedback}
    </View>
  )
}
