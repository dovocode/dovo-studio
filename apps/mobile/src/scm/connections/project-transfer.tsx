import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { Schema } from 'effect'
import {
  decodeResult,
  validationMessages,
  projectTransferActive,
  projectTransferLabel,
  projectTransferPeers,
  projectTransferInspectionSchema,
  projectTransferSchema,
  projectTransferStartSchema,
  projectTransferTargetsSchema,
  type ProjectTransfer,
  type Repository,
} from '@dovo/protocol'
import { randomUUID } from 'expo-crypto'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import {
  SettingsAction as Action,
  SettingsChoice as Choice,
  SettingsField as Field,
} from '../../screens/settings-controls'
import { Switch } from '../../ui/controls/switch'
import { useTheme } from '../../ui/theme'

export function ProjectTransferSettings({ repository }: { repository: Repository }) {
  const runtime = useRuntime(),
    { styles, colors } = useTheme()
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [inspection, setInspection] = useState<typeof projectTransferInspectionSchema.Type | null>(
    null,
  )
  const [targets, setTargets] = useState<typeof projectTransferTargetsSchema.Type>([])
  const [targetId, setTargetId] = useState(''),
    [transport, setTransport] = useState('p2p')
  const [ignored, setIgnored] = useState<string[]>([]),
    [showIgnored, setShowIgnored] = useState(false)
  const [sshHost, setSshHost] = useState(''),
    [sshUser, setSshUser] = useState('')
  const [sshPort, setSshPort] = useState('22'),
    [runtimePort, setRuntimePort] = useState('')
  const [identityFile, setIdentityFile] = useState('')
  const [localJob, setLocalJob] = useState<ProjectTransfer | null>(null)
  const latest = runtime.snapshot?.projectTransfers
    ?.filter((job) => job.repositoryId === repository.id)
    .at(-1)
  const job = (latest?.updatedAt ?? 0) >= (localJob?.updatedAt ?? 0) ? latest : localJob
  const active = !!job && projectTransferActive(job)
  const pending = useRef(false),
    refreshed = useRef('')
  const act = async (action: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const choose = (id: string) => {
    setTargetId(id)
    const target = runtime.overviews.find(
      (entry) => (entry.profile.connection.runtimeId ?? entry.snapshot?.runtimeId) === id,
    )
    if (target) {
      const url = new URL(target.profile.connection.address)
      setSshHost(url.hostname)
      setRuntimePort(url.protocol === 'https:' ? '5235' : url.port || '80')
    }
  }
  const load = () =>
    act(async () => {
      const peers = projectTransferPeers(
        runtime.profiles,
        runtime.overviews,
        runtime.snapshot?.runtimeId,
      )
      await runtime.call(
        '/api/retrieval/peers',
        { sessionId: 'project-transfer', peers },
        Schema.Struct({ ok: Schema.Boolean }),
      )
      const [machines, files] = await Promise.all([
        runtime.read('/api/scm/project-transfer/targets', {}, projectTransferTargetsSchema),
        runtime.read(
          '/api/scm/project-transfer/inspect',
          { repositoryId: repository.id },
          projectTransferInspectionSchema,
        ),
      ])
      setTargets(machines)
      setInspection(files)
      setIgnored((previous) =>
        previous.filter((path) => files.ignoredFiles.some((file) => file.path === path)),
      )
      if (!machines.some((machine) => machine.id === targetId)) choose(machines[0]?.id ?? '')
    })
  useEffect(() => {
    if (job?.state !== 'completed' || refreshed.current === job.id) return
    const target = runtime.overviews.find(
      (entry) => (entry.profile.connection.runtimeId ?? entry.snapshot?.runtimeId) === job.targetId,
    )
    if (target) {
      refreshed.current = job.id
      void runtime
        .refreshRuntime(target.profile)
        .catch((error) => setError(error instanceof Error ? error.message : String(error)))
    }
  }, [job, runtime.overviews, runtime.refreshRuntime])
  if (repository.kind === 'scratch') return null
  if (!runtime.snapshot?.projectTransfersSupported)
    return (
      <Text style={styles.muted}>Update this computer to copy projects to another computer.</Text>
    )
  const start = (retry = false) =>
    act(async () => {
      if (retry && job) {
        setLocalJob(
          await runtime.call(
            '/api/scm/project-transfer/retry',
            { id: job.id },
            projectTransferSchema,
          ),
        )
        return
      }
      const parsed = decodeResult(projectTransferStartSchema, {
        id: randomUUID(),
        repositoryId: repository.id,
        targetId,
        ignoredFiles: ignored,
        ...(transport === 'ssh'
          ? {
              ssh: {
                sshHost,
                sshUser,
                sshPort: Number(sshPort),
                runtimePort: Number(runtimePort),
                identityFile: identityFile || undefined,
              },
            }
          : {}),
      })
      if (!parsed.success)
        throw new Error(
          validationMessages(parsed.error)[0] ?? 'Check the destination and SSH settings.',
        )
      const input = parsed.data
      setLocalJob(
        await runtime.call('/api/scm/project-transfer/start', input, projectTransferSchema),
      )
    })
  return (
    <View style={{ gap: 10 }}>
      <Action
        secondary
        label={open ? 'Hide project copy' : 'Add to another computer'}
        onPress={() => {
          setOpen(!open)
          if (!open) void load()
        }}
      />
      {job && (
        <View accessibilityLiveRegion="polite" style={{ gap: 6 }}>
          <Text style={job.state === 'failed' ? { color: colors.error } : styles.text}>
            {projectTransferLabel(job)}
          </Text>
          {active && (
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="Project copy progress"
              accessibilityValue={{
                min: 0,
                max: 100,
                now: job.totalBytes ? Math.floor((job.bytes / job.totalBytes) * 100) : 0,
              }}
              style={{
                height: 4,
                backgroundColor: colors.border,
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  height: 4,
                  width: `${job.totalBytes ? Math.min(100, (job.bytes / job.totalBytes) * 100) : 0}%`,
                  backgroundColor: colors.action,
                }}
              />
            </View>
          )}
          {job.path && (
            <Text selectable style={styles.muted}>
              {job.path}
            </Text>
          )}
          {!!job.skippedLinks && (
            <Text style={styles.muted}>{job.skippedLinks} symbolic links skipped.</Text>
          )}
          {active && (
            <Action
              secondary
              label="Cancel copy"
              disabled={busy}
              onPress={() =>
                void act(async () => {
                  await runtime.call(
                    '/api/scm/project-transfer/cancel',
                    { id: job.id },
                    Schema.Struct({ ok: Schema.Boolean }),
                  )
                })
              }
            />
          )}
        </View>
      )}
      {open && (
        <View style={{ gap: 12 }}>
          <Text style={styles.muted}>
            Copy files and local Git history. The source project and chats stay here. A new folder
            is created under ~/.dovo/projects on the destination.
          </Text>
          <Choice
            label="Destination computer"
            value={targetId}
            onChange={choose}
            items={targets.map((target) => ({ id: target.id, name: target.name }))}
            disabled={busy || active}
          />
          {!targets.length && (
            <Text style={styles.muted}>
              Pair another computer in Settings → Computers, then refresh.
            </Text>
          )}
          <Choice
            label="Project copy connection"
            value={transport}
            onChange={setTransport}
            items={[
              { id: 'p2p', name: 'Dovo P2P' },
              { id: 'ssh', name: 'SSH tunnel' },
            ]}
            disabled={busy || active}
          />
          {transport === 'ssh' && (
            <View style={{ gap: 10 }}>
              <Text style={styles.muted}>
                SSH runs on the source computer, using its trusted SSH keys. Dovo must be running on
                the paired destination.
              </Text>
              <Field
                label="SSH host"
                value={sshHost}
                onChangeText={setSshHost}
                editable={!busy && !active}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Field
                label="SSH user"
                value={sshUser}
                onChangeText={setSshUser}
                editable={!busy && !active}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="SSH port"
                    value={sshPort}
                    onChangeText={setSshPort}
                    keyboardType="number-pad"
                    editable={!busy && !active}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Destination Dovo HTTP port"
                    value={runtimePort}
                    onChangeText={setRuntimePort}
                    keyboardType="number-pad"
                    editable={!busy && !active}
                  />
                </View>
              </View>
              <Field
                label="SSH key on source (optional)"
                value={identityFile}
                onChangeText={setIdentityFile}
                editable={!busy && !active}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Use configured SSH keys"
              />
            </View>
          )}
          {inspection && (
            <View style={{ gap: 8 }}>
              <Text style={styles.muted}>
                {inspection.files} files · {(inspection.bytes / 1048576).toFixed(1)} MB, plus Git
                history.
              </Text>
              {!!inspection.skippedLinks && (
                <Text style={styles.muted}>
                  {inspection.skippedLinks} symbolic links will be skipped.
                </Text>
              )}
              {!!inspection.ignoredFiles.length && (
                <Action
                  secondary
                  label={`Ignored or private files (${ignored.length} selected)`}
                  onPress={() => setShowIgnored(!showIgnored)}
                />
              )}
              {showIgnored && (
                <View style={{ gap: 8 }}>
                  <Text style={styles.muted}>
                    Select only configuration and secrets you want on the destination. Generated
                    folders are excluded.
                  </Text>
                  {inspection.ignoredFiles.map((file) => (
                    <View
                      key={file.path}
                      style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}
                    >
                      <Text style={[styles.text, { flex: 1 }]}>{file.path}</Text>
                      <Switch
                        accessibilityLabel={`Include ${file.path}`}
                        value={ignored.includes(file.path)}
                        disabled={busy || active}
                        onValueChange={(checked) =>
                          setIgnored((current) =>
                            checked
                              ? [...current, file.path]
                              : current.filter((path) => path !== file.path),
                          )
                        }
                      />
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
          {!active && (
            <>
              <Action
                label={busy ? 'Preparing…' : 'Copy project'}
                disabled={busy || !inspection || !targetId || !runtime.connected}
                onPress={() => void start()}
              />
              {job?.state === 'failed' && (
                <Action
                  secondary
                  label="Retry copy"
                  disabled={busy || !runtime.connected}
                  onPress={() => void start(true)}
                />
              )}
              <Action
                secondary
                label="Refresh copy options"
                disabled={busy || !runtime.connected}
                onPress={() => void load()}
              />
            </>
          )}
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      )}
    </View>
  )
}
