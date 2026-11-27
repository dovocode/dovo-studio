import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  pipelineComparisonLog,
  pipelineComparisonRows,
} from '@dovo/studio-core/pipeline-comparison'
import { useComparison } from '@dovo/studio-core/comparison'
import type { ForgePipelineComparison } from '@dovo/protocol'
import { View } from 'react-native'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { WorkSignal } from '../pulls/detail/pipeline-details'

export function PipelineComparison({
  load,
  connected,
  onOpen,
}: {
  load: () => Promise<ForgePipelineComparison>
  connected: boolean
  onOpen: (url: string) => void
}) {
  const uiText = useInterfaceText()
  const { styles } = useTheme()
  const { state, open, close } = useComparison(load)
  if (state.status === 'closed')
    return (
      <Action
        secondary
        disabled={!connected}
        label={uiText('Compare with last success')}
        onPress={() => void open()}
      />
    )
  const comparison = state.status === 'ready' ? state.value : undefined
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.title}>{uiText('Compare with last success')}</Text>
      <Action secondary label={uiText('Close comparison')} onPress={close} />
      {state.status === 'loading' && (
        <Text accessibilityLiveRegion="polite">{uiText('Loading comparison…')}</Text>
      )}
      {state.status === 'failed' && (
        <>
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {state.error}
          </Text>
          <Action
            secondary
            disabled={!connected}
            label={uiText('Retry')}
            onPress={() => void open()}
          />
        </>
      )}
      {comparison && !comparison.baseline && (
        <Text>{uiText('No earlier successful run for this workflow and branch.')}</Text>
      )}
      {comparison?.baseline && (
        <>
          {[comparison.current.run, comparison.baseline.run].map((run) => (
            <Action
              key={run.id}
              secondary
              label={uiText('Run {value0} · Attempt {value1}', {
                value0: run.number || run.id,
                value1: run.attempt ?? 1,
              })}
              onPress={() => onOpen(run.url)}
            />
          ))}
          {pipelineComparisonRows(comparison).map(({ job, previous, step, previousStep }) => (
            <View key={job.id} style={[styles.card, { gap: 6 }]}>
              <Text>{job.name}</Text>
              <WorkSignal status={job.status} />
              <Action
                secondary
                label={step?.name ?? uiText('Open job logs')}
                onPress={() => onOpen(pipelineComparisonLog(job, step))}
              />
              {previous ? (
                <>
                  <WorkSignal status={previousStep?.status ?? previous.status} />
                  <Action
                    secondary
                    label={previousStep?.name ?? uiText('Open previous job logs')}
                    onPress={() => onOpen(pipelineComparisonLog(previous, previousStep))}
                  />
                </>
              ) : (
                <Text style={styles.muted}>{uiText('No matching job in the successful run.')}</Text>
              )}
            </View>
          ))}
        </>
      )}
    </View>
  )
}
