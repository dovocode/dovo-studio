import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect } from 'react'
import { PipelineStepProgress } from './pipeline-step-progress'
import { useForegroundInterval } from '../../../runtime/state/app-active'
import { useApplicationState } from '../../../runtime/state/application-state'
import { Pressable, View } from 'react-native'
import {
  pipelineGraphColumns,
  pipelineFailureImpact,
  type ForgePipelineDetail,
  pipelineDuration,
  pipelineSignal,
  type ForgePipeline,
  type ForgePipelineJob,
} from '@dovo/protocol'
import { Action } from '../../../ui/controls/action'
import { Icon } from '../../../ui/controls/icon'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { formatDateTime } from '../../../ui/content/format-date'
import { useNavigation } from '../../../shell/navigation'
function usePipelineNow(active: boolean) {
  const { focused } = useNavigation()
  const [now, setNow] = useApplicationState(Date.now)
  useForegroundInterval(() => setNow(Date.now()), active && focused ? 1000 : null)
  return now
}
export function WorkSignal({ status, emphasis = false }: { status: string; emphasis?: boolean }) {
  const { colors, styles } = useTheme()

  const signal = pipelineSignal(status)
  const color = {
    success: colors.success,
    danger: colors.error,
    warning: colors.warning,
    info: colors.accent,
    neutral: colors.muted,
  }[signal.tone]
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={[styles.muted, { color, fontWeight: emphasis ? '600' : '500', flexShrink: 1 }]}>
        {signal.label}
      </Text>
    </View>
  )
}
function date(value?: string) {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : formatDateTime(parsed)
}
function Metadata({ label, value }: { label: string; value?: string }) {
  const { styles } = useTheme()

  return value ? (
    <View
      style={{
        flexDirection: 'row',
        gap: 12,
        paddingVertical: 3,
      }}
    >
      <Text
        style={[
          styles.muted,
          {
            width: 82,
          },
        ]}
      >
        {label}
      </Text>
      <Text
        selectable
        style={[
          styles.text,
          {
            flex: 1,
            minWidth: 0,
            fontSize: 15,
          },
        ]}
      >
        {value}
      </Text>
    </View>
  ) : null
}
function Errors({ errors }: { errors?: string[] }) {
  const { styles } = useTheme()

  return errors?.length ? (
    <View
      style={{
        gap: 6,
      }}
    >
      {errors.map((error, index) => (
        <Text key={index} selectable style={styles.error}>
          {error}
        </Text>
      ))}
    </View>
  ) : null
}
export function PipelineRunInfo({ run }: { run: ForgePipeline }) {
  const uiText = useInterfaceText()

  const { styles, colors } = useTheme()

  const now = usePipelineNow(pipelineSignal(run.status).phase === 'active' && !!run.startedAt)
  const duration = pipelineDuration(run, now)
  return (
    <View style={[styles.card, { gap: 12, padding: 16 }]}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <WorkSignal status={run.status} emphasis />
        <Text style={styles.muted}>
          <InterfaceText
            values={{
              value0: run.number || run.id,
              value1: run.attempt ? uiText(' · Attempt {value0}', { value0: run.attempt }) : '',
            }}
          >
            {'Run {value0}{value1}'}
          </InterfaceText>
        </Text>
      </View>
      {run.workflow && <Text style={[styles.muted, { fontWeight: '600' }]}>{run.workflow}</Text>}
      <Text
        selectable
        style={[
          styles.title,
          {
            fontSize: 22,
            lineHeight: 28,
          },
        ]}
      >
        {run.title}
      </Text>
      <View style={[styles.row, { gap: 12 }]}>
        {!!run.ref && (
          <View style={[styles.row, { flexShrink: 1 }]}>
            <Icon name="changes" size={13} color={colors.muted} />
            <Text selectable style={[styles.muted, { flexShrink: 1 }]}>
              {run.ref}
            </Text>
          </View>
        )}
        {!!run.sha && (
          <Text selectable style={styles.muted}>
            {run.sha.slice(0, 8)}
          </Text>
        )}
        {duration && <Text style={styles.muted}>{duration}</Text>}
      </View>
      {run.actor && (
        <Text style={styles.muted}>
          <InterfaceText values={{ value0: run.actor }}>{'Triggered by {value0}'}</InterfaceText>
        </Text>
      )}
      <Errors errors={run.errors} />
    </View>
  )
}
export function PipelineRunDetails({ run }: { run: ForgePipeline }) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  const [expanded, setExpanded] = useApplicationState(false)
  return (
    <View
      style={{
        gap: 4,
      }}
    >
      <Pressable
        testID="Pipeline run details"
        accessibilityRole="button"
        accessibilityLabel={uiText('Pipeline run details')}
        accessibilityState={{
          expanded,
        }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [
          styles.row,
          {
            minHeight: 44,
            flexWrap: 'nowrap',
            opacity: pressed ? 0.55 : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.text,
            {
              flex: 1,
              fontSize: 15,
            },
          ]}
        >
          <InterfaceText>{'Run details'}</InterfaceText>
        </Text>
        <Icon name={expanded ? 'down' : 'next'} size={13} color={colors.muted} />
      </Pressable>
      {expanded && (
        <View
          style={{
            gap: 2,
            paddingBottom: 8,
          }}
        >
          {!!run.commitMessage && (
            <Text
              selectable
              style={[
                styles.text,
                {
                  fontSize: 15,
                  marginBottom: 8,
                },
              ]}
            >
              {run.commitMessage}
            </Text>
          )}
          <Metadata label={uiText('Run')} value={run.number ?? run.id} />
          <Metadata label={uiText('Workflow')} value={run.workflow ?? run.definition} />
          <Metadata label={uiText('Trigger')} value={run.event} />
          <Metadata label={uiText('Branch')} value={run.ref} />
          <Metadata label={uiText('Commit')} value={run.sha} />
          <Metadata label={uiText('Actor')} value={run.actor} />
          <Metadata label={uiText('Created')} value={date(run.createdAt)} />
          <Metadata label={uiText('Started')} value={date(run.startedAt)} />
          <Metadata label={uiText('Finished')} value={date(run.completedAt)} />
          <Metadata label={uiText('Updated')} value={date(run.updatedAt)} />
        </View>
      )}
    </View>
  )
}
function PipelineJob({
  job,
  onOpen,
  now,
  selected = false,
}: {
  selected?: boolean
  job: ForgePipelineJob
  onOpen: (url: string) => void
  now: number
}) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  const failed = pipelineSignal(job.status).tone === 'danger' || !!job.errors?.length
  const [expanded, setExpanded] = useApplicationState(failed)
  useEffect(() => {
    if (failed || selected) setExpanded(true)
  }, [failed, selected])
  const duration = pipelineDuration(job, now)
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: selected ? colors.accent : failed ? colors.error : colors.border,
        backgroundColor: colors.surface,
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <Pressable
        testID={`Job ${job.name}`}
        accessibilityRole="button"
        accessibilityLabel={uiText('Job {value0}', { value0: job.name })}
        accessibilityState={{
          expanded,
        }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [
          styles.row,
          {
            flexWrap: 'nowrap',
            minHeight: 56,
            padding: 14,
            opacity: pressed ? 0.55 : 1,
          },
        ]}
      >
        <View
          style={{
            flex: 1,
            minWidth: 0,
            gap: 4,
          }}
        >
          <Text
            style={[
              styles.text,
              {
                fontWeight: '600',
              },
            ]}
          >
            {job.name}
          </Text>
          <View style={styles.row}>
            <WorkSignal status={job.status} />
            {duration && <Text style={styles.muted}>· {duration}</Text>}
          </View>
          <PipelineStepProgress job={job} />
        </View>
        <Icon name={expanded ? 'down' : 'next'} size={13} color={colors.muted} />
      </Pressable>
      {expanded && (
        <View
          style={{
            gap: 14,
            padding: 14,
            borderTopWidth: 0.5,
            borderTopColor: colors.border,
          }}
        >
          <Errors errors={job.errors} />
          {job.steps?.length ? (
            <View
              style={{
                gap: 12,
              }}
            >
              {job.steps.map((step) => (
                <View
                  key={step.id}
                  style={{
                    gap: 4,
                    paddingLeft: 12,
                    borderLeftWidth: 2,
                    borderLeftColor:
                      pipelineSignal(step.status).tone === 'danger' ? colors.error : colors.border,
                  }}
                >
                  <Text
                    style={[
                      styles.text,
                      {
                        fontSize: 15,
                      },
                    ]}
                  >
                    {step.number !== undefined ? `${step.number}. ` : ''}
                    {step.name}
                  </Text>
                  <View style={styles.row}>
                    <WorkSignal status={step.status} />
                    {!!pipelineDuration(step, now) && (
                      <Text style={styles.muted}>· {pipelineDuration(step, now)}</Text>
                    )}
                  </View>
                  <Errors errors={step.errors} />
                  {step.url && (
                    <Action
                      secondary
                      label={uiText('Open {value0} logs', { value0: step.name })}
                      onPress={() => onOpen(step.url!)}
                    />
                  )}
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>
              <InterfaceText>
                {'The provider did not supply step details for this job.'}
              </InterfaceText>
            </Text>
          )}
          <Action
            secondary
            label={uiText('Open {value0} logs', { value0: job.name })}
            onPress={() => onOpen(job.url)}
          />
          <View>
            <Metadata label={uiText('Runner')} value={job.runner} />
            <Metadata label={uiText('Started')} value={date(job.startedAt)} />
            <Metadata label={uiText('Finished')} value={date(job.completedAt)} />
          </View>
        </View>
      )}
    </View>
  )
}
export function PipelineJobs({
  graph,
  graphNotice,
  jobs,
  hasMore,
  onOpen,
  ready = true,
}: {
  ready?: boolean
  graph?: ForgePipelineDetail['graph']
  graphNotice?: string
  jobs: ForgePipelineJob[]
  hasMore: boolean
  onOpen: (url: string) => void
}) {
  const uiText = useInterfaceText()

  const { styles, colors } = useTheme()
  const [selected, setSelected] = useApplicationState<string | null>(null)
  const columns = pipelineGraphColumns(graph, jobs)
  const impact = pipelineFailureImpact(graph, jobs)

  const now = usePipelineNow(
    jobs.some(
      (job) =>
        (!!job.startedAt && pipelineSignal(job.status).phase === 'active') ||
        job.steps?.some(
          (step) => !!step.startedAt && pipelineSignal(step.status).phase === 'active',
        ),
    ),
  )
  const failures = jobs.filter(
    (job) => pipelineSignal(job.status).tone === 'danger' || job.errors?.length,
  ).length
  return (
    <View
      style={{
        gap: 10,
      }}
    >
      {!!columns.length && (
        <View accessibilityLabel={uiText('Pipeline graph')} style={{ gap: 10 }}>
          <Text style={styles.text}>
            <InterfaceText>{'Workflow'}</InterfaceText>
          </Text>
          {graphNotice && <Text style={styles.muted}>{graphNotice}</Text>}
          {!graph && (
            <Text style={styles.muted}>
              <InterfaceText>{'Jobs · dependencies not provided'}</InterfaceText>
            </Text>
          )}
          <View style={{ gap: 16, paddingVertical: 8 }}>
            {columns.map((column, index) => (
              <View key={index} style={{ gap: 12 }}>
                {columns.length > 1 && (
                  <Text
                    style={[styles.muted, { fontSize: 11, fontWeight: '600', letterSpacing: 1 }]}
                  >
                    <InterfaceText values={{ value0: index + 1 }}>{'STAGE {value0}'}</InterfaceText>
                  </Text>
                )}
                {column.map((node) => (
                  <View
                    key={node.id}
                    style={[
                      styles.card,
                      {
                        gap: 8,
                        borderLeftWidth: impact.affected.has(node.id) ? 3 : 0,
                        borderLeftColor: impact.failed.has(node.id) ? colors.error : colors.warning,
                      },
                    ]}
                  >
                    <Text style={[styles.text, { fontWeight: '600' }]}>{node.name}</Text>
                    {impact.affected.has(node.id) && (
                      <Text
                        style={{
                          color: impact.failed.has(node.id) ? colors.error : colors.warning,
                        }}
                      >
                        {impact.failed.has(node.id)
                          ? uiText('Failed stage')
                          : uiText('Depends on failed stage')}
                      </Text>
                    )}
                    {!!node.needs.length && (
                      <Text style={styles.muted}>
                        <InterfaceText values={{ value0: node.needs.join(', ') }}>
                          {'After {value0}'}
                        </InterfaceText>
                      </Text>
                    )}
                    {node.jobIds.map((id) => {
                      const job = jobs.find((job) => job.id === id)
                      return (
                        job && (
                          <Pressable
                            key={id}
                            accessibilityRole="button"
                            accessibilityLabel={uiText('View job {value0}', { value0: job.name })}
                            accessibilityState={{ selected: selected === id }}
                            onPress={() => setSelected(id)}
                            style={{
                              padding: 10,
                              gap: 8,
                              minHeight: 44,
                              backgroundColor: selected === id ? colors.selection : colors.elevated,
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor: selected === id ? colors.accent : colors.border,
                            }}
                          >
                            {job.name !== node.name && <Text style={styles.text}>{job.name}</Text>}
                            <View style={[styles.row, { justifyContent: 'space-between' }]}>
                              <WorkSignal status={job.status} />
                              <Text style={styles.muted}>{pipelineDuration(job, now)}</Text>
                            </View>
                            <PipelineStepProgress job={job} />
                          </Pressable>
                        )
                      )
                    })}
                    {!node.jobIds.length && (
                      <Text style={styles.muted}>
                        <InterfaceText>{'Not reported'}</InterfaceText>
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            ))}
          </View>
        </View>
      )}
      {!columns.length && graphNotice && <Text style={styles.muted}>{graphNotice}</Text>}
      <Text
        accessibilityRole="header"
        style={[
          styles.text,
          {
            fontWeight: '600',
            paddingBottom: 6,
          },
        ]}
      >
        <InterfaceText
          values={{
            value0: ready ? ` · ${jobs.length}` : '',
            value1: hasMore ? uiText(' loaded') : '',
            value2: failures ? uiText(' · {value0} failed', { value0: failures }) : '',
          }}
        >
          {'Jobs{value0}{value1}{value2}'}
        </InterfaceText>
      </Text>
      {ready && !jobs.length && (
        <Text style={styles.muted}>
          <InterfaceText>{'No jobs have been returned for this run.'}</InterfaceText>
        </Text>
      )}
      {[...jobs]
        .sort(
          (a, b) =>
            Number(pipelineSignal(b.status).tone === 'danger' || !!b.errors?.length) -
            Number(pipelineSignal(a.status).tone === 'danger' || !!a.errors?.length),
        )
        .map((job) => (
          <PipelineJob
            key={job.id}
            job={job}
            selected={selected === job.id}
            onOpen={onOpen}
            now={now}
          />
        ))}
    </View>
  )
}
