import { useInterfaceText } from '@dovo/studio-core/interface-language'
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
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  const error = section.error || section.detail?.refreshError || section.detail?.pull.statusError
  const warnings = section.detail?.warnings ?? []
  if (section.enabled === false) return null
  if (section.ready && !error && !warnings.length) return null
  return (
    <View
      accessibilityLabel={uiText('{value0} loading status', { value0: label })}
      style={{ gap: 8 }}
    >
      <Text
        accessibilityRole={error ? 'alert' : undefined}
        style={error ? styles.error : styles.muted}
      >
        {error
          ? `${label}: ${error}`
          : section.ready
            ? uiText('{value0}: some data could not be loaded.', { value0: label })
            : section.readConnected
              ? uiText('Loading {value0}…', { value0: label.toLowerCase() })
              : uiText('{value0}: connect to load this section.', { value0: label })}
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
            ? uiText('Refreshing {value0}…', { value0: label.toLowerCase() })
            : uiText('Refresh {value0}', { value0: label.toLowerCase() })
        }
        onPress={section.refresh}
      />
    </View>
  )
}
