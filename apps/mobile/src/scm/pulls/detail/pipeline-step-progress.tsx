import { View } from 'react-native'
import { pipelineSignal, type ForgePipelineJob } from '@dovo/protocol'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'

export function PipelineStepProgress({ job }: { job: ForgePipelineJob }) {
  const { colors, styles } = useTheme()
  const steps = job.steps
  if (!steps?.length) return <Text style={styles.muted}>Steps not reported</Text>
  const completed = steps.filter((step) => pipelineSignal(step.status).phase === 'finished').length
  return (
    <View accessibilityLabel={`${job.name} step progress`} style={{ gap: 6 }}>
      <Text style={[styles.muted, { fontSize: 11 }]}>
        {completed}/{steps.length} steps complete
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {steps.map((step) => {
          const signal = pipelineSignal(step.status)
          const color = {
            success: colors.success,
            danger: colors.error,
            warning: colors.warning,
            info: colors.accent,
            neutral: colors.muted,
          }[signal.tone]
          return (
            <View
              key={step.id}
              accessible
              accessibilityRole="image"
              accessibilityLabel={`${step.name}: ${signal.label}`}
              style={{
                height: 6,
                minWidth: 8,
                flexGrow: 1,
                borderRadius: 2,
                backgroundColor: color,
                opacity: signal.tone === 'neutral' ? 0.25 : 1,
              }}
            />
          )
        })}
      </View>
    </View>
  )
}
