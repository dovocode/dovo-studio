import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useMemo, useRef } from 'react'
import { Platform, ScrollView, View } from 'react-native'
import Constants from 'expo-constants'
import * as Clipboard from 'expo-clipboard'
import { randomUUID } from 'expo-crypto'
import { router } from 'expo-router'
import {
  createLauncherTask,
  defaultProblemReportInclude,
  launcherDefaultAgent,
  localProblemDiagnostics,
  problemReportPreviewSchema,
  problemReportRequest,
  problemReportStart,
  problemReportTargets,
  problemReportTitle,
  recentClientErrors,
  runtimeComputerName,
  threadStartResultSchema,
  type LauncherAgent,
  type ProblemReportClient,
  type ProblemReportClientError,
  type ProblemReportForm,
  type ProblemReportPreview,
  type ProblemReportRequest,
  type ProblemReportStart,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { useApplicationState } from '../runtime/state/application-state'
import { appBuild, appChannel, appVersion } from '../runtime/preferences/app-build'
import { readLastCrash } from '../runtime/diagnostics/crash-log'
import { permissionPolicyUIIssue } from '../agents/permission-policy'
import { TaskLauncherPicker } from '../tasks/creation/task-launcher-controls'
import { taskHref } from '../shell/task-route'
import { Text } from '../ui/content/text'
import { ScreenHeader } from '../ui/layout/screen-header'
import { SettingsGroup, SettingsSwitchRow } from './settings-group'
import {
  SettingsAction as Action,
  SettingsChoice as Choice,
  SettingsField as Field,
} from './settings-controls'
import { SettingsPage, useSettingsTheme as useTheme } from './settings-theme'

type Reviewed = { runtimeId: string; request: ProblemReportRequest; preview: ProblemReportPreview }

const client: ProblemReportClient = {
  surface: 'mobile',
  appVersion,
  ...(appBuild ? { build: appBuild } : {}),
  ...(appChannel ? { channel: appChannel } : {}),
  platform: `${Platform.OS} ${String(Platform.Version)}`,
  ...(typeof Constants.expoConfig?.extra?.sourceCommit === 'string'
    ? { commit: Constants.expoConfig.extra.sourceCommit.slice(0, 64) }
    : {}),
}

export default function ReportProblemScreen() {
  const uiText = useInterfaceText()
  const { styles } = useTheme()
  const {
    profiles,
    overviews,
    activeId,
    readRuntime,
    refreshRuntime,
    error: connectionError,
  } = useRuntime()
  const targets = useMemo(() => problemReportTargets(overviews), [overviews])
  const available = targets.filter((target) => target.available)
  const [runtimeId, setRuntimeId] = useApplicationState(
    () =>
      available.find((target) => target.profile.id === activeId)?.profile.id ??
      available[0]?.profile.id ??
      '',
  )
  const target = runtimeId
    ? available.find((entry) => entry.profile.id === runtimeId)
    : (available.find((entry) => entry.profile.id === activeId) ?? available[0])
  const [form, setForm] = useApplicationState<ProblemReportForm>({
    description: '',
    expected: '',
    include: defaultProblemReportInclude,
  })
  const [selection, setSelection] = useApplicationState<LauncherAgent | null>(null)
  const manualSelection = useRef(false)
  const [reviewed, setReviewed] = useApplicationState<Reviewed | null>(null)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [showLocal, setShowLocal] = useApplicationState(false)
  const [copyStatus, setCopyStatus] = useApplicationState('')
  const [errors, setErrors] = useApplicationState<ProblemReportClientError[]>(() =>
    recentClientErrors(),
  )
  const attempt = useRef<{ profile: RuntimeProfile; body: ProblemReportStart } | null>(null)
  // The last crash survives an app restart; include it with this session's errors.
  useEffect(() => {
    let active = true
    void readLastCrash().then((crash) => {
      if (active && crash)
        setErrors((current) => [
          { at: crash.at, message: crash.message, source: crash.fatal ? 'crash' : 'error' },
          ...current,
        ])
    })
    return () => {
      active = false
    }
  }, [setErrors])
  const scratch = target?.scratch
  const snapshot = target?.snapshot
  useEffect(() => {
    if (manualSelection.current) return
    setSelection(snapshot && scratch ? launcherDefaultAgent(snapshot, scratch) : null)
  }, [snapshot, scratch, setSelection])
  const selectionIssue = selection?.harness
    ? permissionPolicyUIIssue(selection.harness, snapshot?.permissionPolicySupported === true)
    : undefined
  const locked = busy || !!attempt.current
  const local = !reviewed && !busy && (showLocal || !available.length)
  const diagnostics = local
    ? localProblemDiagnostics(
        client,
        {
          saved: profiles.length,
          connected: overviews.filter((entry) => entry.connected).length,
          error: connectionError,
        },
        errors,
      )
    : ''

  const preview = async () => {
    if (!target || busy) return
    const request = problemReportRequest(
      {
        ...form,
        include: {
          ...form.include,
          clientTimeline:
            form.include.clientTimeline && target.snapshot?.problemReportTimelineSupported === true,
        },
      },
      client,
      errors,
    )
    if (!request.description) return
    setBusy(true)
    setError('')
    try {
      const result = await readRuntime(
        target.profile,
        '/api/problem-reports/preview',
        request,
        problemReportPreviewSchema,
      )
      setReviewed({ runtimeId: target.profile.id, request, preview: result })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const start = async () => {
    if (!reviewed || busy || selectionIssue) return
    setBusy(true)
    setError('')
    try {
      // The same thread and message IDs are reused on retry, so it cannot start twice.
      if (!attempt.current) {
        if (!target?.snapshot || !target.scratch || !selection)
          throw new Error(uiText('Choose a computer'))
        attempt.current = {
          profile: target.profile,
          body: problemReportStart(
            reviewed.request,
            reviewed.preview,
            {
              ...createLauncherTask(
                target.snapshot,
                target.scratch,
                selection,
                problemReportTitle(reviewed.request.description),
                randomUUID(),
              ),
              harnessCustomized: manualSelection.current || undefined,
            },
            randomUUID(),
          ),
        }
      }
      const current = attempt.current
      await readRuntime(
        current.profile,
        '/api/problem-reports/start',
        current.body,
        threadStartResultSchema,
      )
      void refreshRuntime(current.profile).catch((cause: unknown) =>
        console.error('Could not refresh after starting a problem report:', cause),
      )
      router.replace(taskHref(current.profile.id, current.body.createTask.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const mono = { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 }
  if (local)
    return (
      <SettingsPage>
        <ScreenHeader title={uiText('Report a problem')} />
        <ScrollView contentContainerStyle={[styles.content, { gap: 20 }]}>
          <Text style={styles.muted}>
            <InterfaceText>
              {
                'Preview app diagnostics on this device. Triage requires a connected computer that supports problem reports.'
              }
            </InterfaceText>
          </Text>
          <SettingsGroup title={uiText('Local diagnostics')}>
            <Text selectable style={[styles.text, mono, { padding: 12 }]}>
              {diagnostics}
            </Text>
          </SettingsGroup>
          {!!copyStatus && <Text accessibilityLiveRegion="polite">{copyStatus}</Text>}
          <Action
            label={uiText('Copy diagnostics')}
            onPress={() =>
              void Clipboard.setStringAsync(diagnostics).then(
                () => setCopyStatus(uiText('Diagnostics copied')),
                () =>
                  setCopyStatus(uiText('Could not copy diagnostics. Select the text to copy it.')),
              )
            }
          />
          {!!available.length && (
            <Action
              secondary
              label={uiText('Back to report')}
              onPress={() => setShowLocal(false)}
            />
          )}
        </ScrollView>
      </SettingsPage>
    )
  return (
    <SettingsPage>
      <ScreenHeader title={uiText('Report a problem')} />
      <ScrollView
        contentContainerStyle={[styles.content, { gap: 20 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'An agent on your computer reads redacted diagnostics and the Dovo source for your version, then drafts an issue for you to review. Nothing is filed for you.'
            }
          </InterfaceText>
        </Text>
        {reviewed ? (
          <>
            <Text style={styles.muted}>
              <InterfaceText values={{ value0: reviewed.preview.redactions }}>
                {
                  'The runtime hid {value0} values that looked like credentials, environment values or user names.'
                }
              </InterfaceText>
            </Text>
            <SettingsGroup title={uiText('First message')}>
              <Text selectable style={[styles.text, mono, { padding: 12 }]}>
                {reviewed.preview.message}
              </Text>
            </SettingsGroup>
            {reviewed.preview.attachment ? (
              <SettingsGroup
                title={uiText('Attached file: {value0} · {value1}', {
                  value0: reviewed.preview.attachment.name,
                  value1: `${(reviewed.preview.attachment.bytes / 1024).toFixed(1)} KB`,
                })}
              >
                <Text selectable style={[styles.text, mono, { padding: 12 }]}>
                  {reviewed.preview.attachment.text}
                </Text>
              </SettingsGroup>
            ) : (
              <Text style={styles.muted}>
                <InterfaceText>{'No file is attached.'}</InterfaceText>
              </Text>
            )}
          </>
        ) : (
          <>
            <SettingsGroup>
              <Field
                label={uiText('What happened?')}
                multiline
                maxLength={4000}
                editable={!locked}
                placeholder={uiText('Describe what you did and what went wrong.')}
                value={form.description}
                onChangeText={(description) => setForm({ ...form, description })}
              />
              <Field
                label={uiText('What did you expect?')}
                multiline
                maxLength={4000}
                editable={!locked}
                value={form.expected}
                onChangeText={(expected) => setForm({ ...form, expected })}
              />
            </SettingsGroup>
            {!!available.length && (
              <SettingsGroup>
                <Choice
                  label={uiText('Computer')}
                  value={target?.profile.id ?? ''}
                  disabled={locked}
                  items={available.map((entry) => ({
                    id: entry.profile.id,
                    name: runtimeComputerName({ profile: entry.profile, snapshot: entry.snapshot }),
                  }))}
                  onChange={(id) => {
                    manualSelection.current = false
                    setRuntimeId(id)
                  }}
                />
                {target?.snapshot && target.scratch && selection && (
                  <View style={{ padding: 12 }}>
                    <TaskLauncherPicker
                      selection={selection}
                      snapshot={target.snapshot}
                      repository={target.scratch}
                      disabled={locked}
                      onChange={(next) => {
                        manualSelection.current = true
                        setSelection(next)
                      }}
                    />
                  </View>
                )}
              </SettingsGroup>
            )}
            <SettingsGroup title={uiText('Include')}>
              <SettingsSwitchRow
                first
                label={uiText('App and runtime versions')}
                value={form.include.versions}
                disabled={locked}
                onValueChange={(versions) =>
                  setForm({ ...form, include: { ...form.include, versions } })
                }
              />
              <SettingsSwitchRow
                label={uiText('Runtime diagnostics and logs')}
                value={form.include.diagnostics}
                disabled={locked}
                onValueChange={(diagnostics) =>
                  setForm({ ...form, include: { ...form.include, diagnostics } })
                }
              />
              <SettingsSwitchRow
                label={uiText('Recent app errors ({value0})', { value0: errors.length })}
                value={form.include.clientErrors}
                disabled={locked}
                onValueChange={(clientErrors) =>
                  setForm({ ...form, include: { ...form.include, clientErrors } })
                }
              />
              {snapshot?.problemReportTimelineSupported && (
                <SettingsSwitchRow
                  label={uiText('Recent app actions')}
                  value={form.include.clientTimeline === true}
                  disabled={locked}
                  onValueChange={(clientTimeline) =>
                    setForm({ ...form, include: { ...form.include, clientTimeline } })
                  }
                />
              )}
            </SettingsGroup>
          </>
        )}
        {!!(error || selectionIssue) && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error || selectionIssue}
          </Text>
        )}
        {reviewed ? (
          <>
            <Action
              label={attempt.current ? uiText('Retry') : uiText('Start triage thread')}
              disabled={busy || !!selectionIssue}
              onPress={() => void start()}
            />
            <Action
              secondary
              label={uiText('Edit report')}
              disabled={locked}
              onPress={() => {
                setReviewed(null)
                setError('')
              }}
            />
          </>
        ) : (
          <>
            <Action
              secondary
              label={uiText('Local diagnostics')}
              disabled={locked}
              onPress={() => setShowLocal(true)}
            />
            <Action
              label={uiText('Preview')}
              disabled={busy || !target || !form.description.trim()}
              onPress={() => void preview()}
            />
          </>
        )}
      </ScrollView>
    </SettingsPage>
  )
}
