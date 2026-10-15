import { View } from 'react-native'
import { Text } from '../../../ui/content/text'
import { Action } from '../../../ui/controls/action'
import { useTheme } from '../../../ui/theme'
import type { usePullDetail } from './use-pull-detail'

export function PullSectionStatus({
  label,
  section,
}: {
  label: string
  section: ReturnType<typeof usePullDetail>['sections']['overview']
}) {
  const { styles } = useTheme()
  const error = section.error || section.detail?.refreshError || section.detail?.pull.statusError
  const warnings = section.detail?.warnings ?? []
  if (section.enabled === false) return null
  if (section.ready && !error && !warnings.length && !section.detail?.stale) return null
  return (
    <View accessibilityLabel={`${label} loading status`} style={{ gap: 8 }}>
      <Text
        accessibilityRole={error ? 'alert' : undefined}
        style={error ? styles.error : styles.muted}
      >
        {error
          ? `${label}: ${error}`
          : section.ready
            ? section.detail?.stale
              ? `${label}: showing cached data.`
              : `${label}: some data could not be loaded.`
            : section.readConnected
              ? `Loading ${label.toLowerCase()}…`
              : `${label}: connect to load this section.`}
      </Text>
      {warnings.map((warning) => (
        <Text key={warning} accessibilityRole="alert" style={styles.error}>
          {warning}
        </Text>
      ))}
      <Action
        secondary
        disabled={!section.readConnected || section.busy}
        label={
          section.refreshing
            ? `Refreshing ${label.toLowerCase()}…`
            : `Refresh ${label.toLowerCase()}`
        }
        onPress={section.refresh}
      />
    </View>
  )
}
