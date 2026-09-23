import { useApplicationState } from '../runtime/application-state'
import { useEffect } from 'react'
import { Pressable, View } from 'react-native'
import {
  pipelineDuration,
  pipelineSignal,
  type ForgePipeline,
  type ForgePipelineJob,
} from '@dovo/protocol'
import { Action } from '../ui/action'
import { Icon } from '../ui/icon'
import { Text } from '../ui/text'
import { colors, styles } from '../ui/theme'
import { useNavigation } from '../shell/navigation'
function usePipelineNow(active: boolean) {
  const { focused } = useNavigation()
  const [now, setNow] = useApplicationState(Date.now)
  useEffect(() => {
    if (!focused || !active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [focused, active])
  return now
}
export function WorkSignal({ status, emphasis = false }: { status: string; emphasis?: boolean }) {
  const signal = pipelineSignal(status)
  const color = {
    success: '#8ad5b0',
    danger: colors.error,
    warning: '#e7c681',
    info: colors.accent,
    neutral: colors.muted,
  }[signal.tone]
  return (
    <Text
      style={[
        styles.muted,
        {
          color,
          fontWeight: emphasis ? '600' : '400',
          flexShrink: 1,
        },
      ]}
    >
      {signal.label}
    </Text>
  )
}
function date(value?: string) {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toLocaleString()
}
function Metadata({ label, value }: { label: string; value?: string }) {
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
  const now = usePipelineNow(pipelineSignal(run.status).phase === 'active' && !!run.startedAt)
  const duration = pipelineDuration(run, now)
  return (
    <View
      style={{
        gap: 10,
      }}
    >
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
      <View style={styles.row}>
        <WorkSignal status={run.status} emphasis />
        {duration && <Text style={styles.muted}>· {duration}</Text>}
        {run.attempt !== undefined && <Text style={styles.muted}>· Attempt {run.attempt}</Text>}
      </View>
      <Text selectable style={styles.muted}>
        {[run.ref, run.sha.slice(0, 8), run.actor].filter(Boolean).join(' · ')}
      </Text>
      <Errors errors={run.errors} />
    </View>
  )
}
export function PipelineRunDetails({ run }: { run: ForgePipeline }) {
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
}: {
  job: ForgePipelineJob
  onOpen: (url: string) => void
  now: number
}) {
  const failed = pipelineSignal(job.status).tone === 'danger' || !!job.errors?.length
  const [expanded, setExpanded] = useApplicationState(failed)
  useEffect(() => {
    if (failed) setExpanded(true)
  }, [failed])
  const duration = pipelineDuration(job, now)
  return (
    <View
      style={{
        borderTopWidth: 0.5,
        borderColor: colors.border,
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
            paddingVertical: 10,
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
            gap: 10,
            paddingBottom: 12,
          }}
        >
          <Errors errors={job.errors} />
          {job.steps?.length ? (
            <View
              style={{
                gap: 12,
              }}
            >
              {[...job.steps]
                .sort(
                  (a, b) =>
                    Number(pipelineSignal(b.status).tone === 'danger') -
                    Number(pipelineSignal(a.status).tone === 'danger'),
                )
                .map((step) => (
                  <View
                    key={step.id}
                    style={{
                      gap: 4,
                      paddingLeft: 12,
                      borderLeftWidth: 1,
                      borderLeftColor: colors.border,
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
  jobs,
  hasMore,
  onOpen,
}: {
  jobs: ForgePipelineJob[]
  hasMore: boolean
  onOpen: (url: string) => void
}) {
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
        gap: 4,
      }}
    >
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
        Jobs · {jobs.length}
        {hasMore ? ' loaded' : ''}
        {failures ? ` · ${failures} failed` : ''}
      </Text>
      {!jobs.length && <Text style={styles.muted}>No jobs have been returned for this run.</Text>}
      {[...jobs]
        .sort(
          (a, b) =>
            Number(pipelineSignal(b.status).tone === 'danger' || !!b.errors?.length) -
            Number(pipelineSignal(a.status).tone === 'danger' || !!a.errors?.length),
        )
        .map((job) => (
          <PipelineJob key={job.id} job={job} onOpen={onOpen} now={now} />
        ))}
    </View>
  )
}
