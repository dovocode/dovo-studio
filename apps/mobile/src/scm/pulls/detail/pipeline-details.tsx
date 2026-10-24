import { useEffect } from 'react'
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
  const { styles, colors } = useTheme()

  const now = usePipelineNow(pipelineSignal(run.status).phase === 'active' && !!run.startedAt)
  const duration = pipelineDuration(run, now)
  return (
    <View style={[styles.card, { gap: 12, padding: 16 }]}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <WorkSignal status={run.status} emphasis />
        <Text style={styles.muted}>
          Run {run.number || run.id}
          {run.attempt ? ` · Attempt ${run.attempt}` : ''}
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
      {run.actor && <Text style={styles.muted}>Triggered by {run.actor}</Text>}
      <Errors errors={run.errors} />
    </View>
  )
}
export function PipelineRunDetails({ run }: { run: ForgePipeline }) {
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
        accessibilityLabel="Pipeline run details"
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
          Run details
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
          <Metadata label="Run" value={run.number ?? run.id} />
          <Metadata label="Workflow" value={run.workflow ?? run.definition} />
          <Metadata label="Trigger" value={run.event} />
          <Metadata label="Branch" value={run.ref} />
          <Metadata label="Commit" value={run.sha} />
          <Metadata label="Actor" value={run.actor} />
          <Metadata label="Created" value={date(run.createdAt)} />
          <Metadata label="Started" value={date(run.startedAt)} />
          <Metadata label="Finished" value={date(run.completedAt)} />
          <Metadata label="Updated" value={date(run.updatedAt)} />
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
        accessibilityLabel={`Job ${job.name}`}
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
                      label={`Open ${step.name} logs`}
                      onPress={() => onOpen(step.url!)}
                    />
                  )}
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>The provider did not supply step details for this job.</Text>
          )}
          <Action secondary label={`Open ${job.name} logs`} onPress={() => onOpen(job.url)} />
          <View>
            <Metadata label="Runner" value={job.runner} />
            <Metadata label="Started" value={date(job.startedAt)} />
            <Metadata label="Finished" value={date(job.completedAt)} />
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
        <View accessibilityLabel="Pipeline graph" style={{ gap: 10 }}>
          <Text style={styles.text}>Workflow</Text>
          {graphNotice && <Text style={styles.muted}>{graphNotice}</Text>}
          {!graph && <Text style={styles.muted}>Jobs · dependencies not provided</Text>}
          <View style={{ gap: 16, paddingVertical: 8 }}>
            {columns.map((column, index) => (
              <View key={index} style={{ gap: 12 }}>
                {columns.length > 1 && (
                  <Text
                    style={[styles.muted, { fontSize: 11, fontWeight: '600', letterSpacing: 1 }]}
                  >
                    STAGE {index + 1}
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
                        {impact.failed.has(node.id) ? 'Failed stage' : 'Depends on failed stage'}
                      </Text>
                    )}
                    {!!node.needs.length && (
                      <Text style={styles.muted}>After {node.needs.join(', ')}</Text>
                    )}
                    {node.jobIds.map((id) => {
                      const job = jobs.find((job) => job.id === id)
                      return (
                        job && (
                          <Pressable
                            key={id}
                            accessibilityRole="button"
                            accessibilityLabel={`View job ${job.name}`}
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
                          </Pressable>
                        )
                      )
                    })}
                    {!node.jobIds.length && <Text style={styles.muted}>Not reported</Text>}
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
        Jobs{ready ? ` · ${jobs.length}` : ''}
        {hasMore ? ' loaded' : ''}
        {failures ? ` · ${failures} failed` : ''}
      </Text>
      {ready && !jobs.length && (
        <Text style={styles.muted}>No jobs have been returned for this run.</Text>
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
