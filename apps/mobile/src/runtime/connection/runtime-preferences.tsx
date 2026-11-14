import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { MobileRemoteDesktop } from '../../screens/remote-desktop'
import { useSettingsDraft } from '../preferences/settings-target'
import { router } from 'expo-router'
import { useEffect, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { SettingsGroup, SettingsSwitchRow } from '../../screens/settings-group'
import { Effect } from 'effect'
import { clientTaskScope } from '@dovo/client-runtime'
import {
  studioToolSettings,
  studioPeerAccessSetting,
  normalizeBranchPrefix,
  runtimePreferencesSchema,
  taskModelSelectionSchema,
  memorySettingsSchema,
  memoryProjectsSchema,
  type MemoryScope,
  artifactRetentionChoices,
  artifactRetentionSchema,
  decode,
  DIAGNOSTIC_RETENTION_DAYS,
} from '@dovo/protocol'
import { useApplicationState } from '../state/application-state'
import { useRuntime } from './provider'
import { useAction } from '../../ui/controls/use-action'
import { SettingsChoice as Choice } from '../../screens/settings-controls'
import { SettingsField as Field } from '../../screens/settings-controls'
import { SettingsAction as Action } from '../../screens/settings-controls'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

type Preferences = typeof runtimePreferencesSchema.Type

/** Preferences stored on the computer itself, shared by every device that manages it. Grouped
 * like the desktop pages: Running tasks, Pull requests & pipelines, Artifacts, memory, worktrees and history. */
export type RuntimePreferencesSection =
  | 'tasks'
  | 'pulls'
  | 'tools'
  | 'artifacts'
  | 'memory'
  | 'worktrees'
  | 'activity'

export function RuntimePreferences({ section }: { section?: RuntimePreferencesSection }) {
  const uiText = useInterfaceText()

  const [desktopOpen, setDesktopOpen] = useState(false)
  const show = (group: RuntimePreferencesSection) => !section || section === group
  const { styles } = useTheme()

  const { connected, snapshot, readEffect, callEffect, overviews, activeId } = useRuntime()
  const webRulesSupported = snapshot?.allowWebRequests !== undefined
  const [value, setValue] = useApplicationState<Preferences | null>(null)
  const [memoryProjects, setMemoryProjects] = useApplicationState<
    typeof memoryProjectsSchema.Type.projects
  >([])
  const [loading, setLoading] = useApplicationState(true)
  const [loadError, setLoadError] = useApplicationState('')
  const [memoryError, setMemoryError] = useApplicationState('')
  const [memoryLoading, setMemoryLoading] = useApplicationState(false)
  const [retry, setRetry] = useApplicationState(0)
  const [saved, setSaved] = useApplicationState(false)
  const { act, busy, error } = useAction()
  useEffect(() => {
    setLoading(connected)
    setSaved(false)
    setLoadError('')
    if (!connected) return
    const scope = clientTaskScope()
    void scope.run(
      readEffect('/api/runtime/preferences/read', {}, runtimePreferencesSchema).pipe(
        Effect.tap((settings) =>
          Effect.sync(() => {
            setValue(settings)
            setLoading(false)
          }),
        ),
        Effect.asVoid,
        Effect.catch((error) =>
          Effect.sync(() => {
            setLoadError(error.message)
            setLoading(false)
          }),
        ),
      ),
    )
    return () => {
      void scope.stop()
    }
  }, [connected, readEffect, retry])
  useEffect(() => {
    let active = true
    setMemoryProjects([])
    setMemoryError('')
    setMemoryLoading(connected)
    if (!connected || (section && section !== 'memory')) {
      setMemoryLoading(false)
      return
    }
    const scope = clientTaskScope()
    void scope.run(
      readEffect('/api/memory/projects/read', {}, memoryProjectsSchema).pipe(
        Effect.tap((library) => Effect.sync(() => setMemoryProjects(library.projects))),
        Effect.asVoid,
        Effect.catch((error) => Effect.sync(() => setMemoryError(error.message))),
        Effect.ensuring(
          Effect.sync(() => {
            if (active) setMemoryLoading(false)
          }),
        ),
      ),
    )
    return () => {
      active = false
      void scope.stop()
    }
  }, [connected, readEffect, setMemoryProjects, setMemoryError, retry, section])
  // Saves only the changed field; the runtime merges it into the rest.
  const save = (changes: Partial<Preferences>) => {
    setSaved(false)
    act(() =>
      callEffect('/api/runtime/preferences/save', changes, runtimePreferencesSchema).pipe(
        Effect.tap((settings) =>
          Effect.sync(() => {
            setValue(settings)
            setSaved(true)
          }),
        ),
      ),
    )
  }
  const configureMemory = (scope: MemoryScope, enabled: boolean, repositoryId?: string) => {
    setSaved(false)
    act(() =>
      callEffect(
        '/api/memory/settings/save',
        { scope, enabled, repositoryId },
        memorySettingsSchema,
      ).pipe(
        Effect.tap((memory) =>
          Effect.sync(() => {
            setValue((current) => (current ? { ...current, memory } : current))
            setSaved(true)
          }),
        ),
      ),
    )
  }
  const disabled = !connected || busy || loading || value === null
  const [prefixDraft, setPrefixDraft] = useApplicationState<string | null>(null)
  useSettingsDraft(prefixDraft !== null && prefixDraft !== (value?.branchPrefix ?? ''), busy)
  const branchPrefix = normalizeBranchPrefix(prefixDraft ?? value?.branchPrefix ?? '')
  useEffect(() => {
    if (prefixDraft !== null && branchPrefix.valid && branchPrefix.prefix === value?.branchPrefix)
      setPrefixDraft(null)
  }, [prefixDraft, branchPrefix.prefix, branchPrefix.valid, value?.branchPrefix, setPrefixDraft])
  const commitPrefix = () => {
    if (prefixDraft !== null && branchPrefix.valid && branchPrefix.prefix !== value?.branchPrefix)
      save({ branchPrefix: branchPrefix.prefix })
    if (branchPrefix.valid && branchPrefix.prefix === value?.branchPrefix) setPrefixDraft(null)
  }
  return (
    <View style={{ gap: 28 }}>
      {section && (
        <Text style={styles.muted}>
          <InterfaceText>
            {'Switches and choices save automatically. Text fields show a Save button.'}
          </InterfaceText>
        </Text>
      )}
      {show('tasks') && (
        <>
          <Text style={styles.muted}>
            <InterfaceText>
              {
                'Computer defaults apply when scoped Task lifecycle settings inherit. Scoped restart and archiving rules take precedence.'
              }
            </InterfaceText>
          </Text>
          <Action
            secondary
            label={uiText('Open scoped task lifecycle')}
            onPress={() =>
              router.push({
                pathname: '/settings/task-lifecycle',
                params: { runtimeId: activeId ?? '' },
              })
            }
          />
        </>
      )}
      {!section && (
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'Saved on this computer and shared with its paired devices. Switches and choices save automatically.'
            }
          </InterfaceText>
        </Text>
      )}
      {!connected ? (
        <Text accessibilityRole="alert" style={styles.muted}>
          <InterfaceText>
            {'This computer is offline. Reconnect to load and change its preferences.'}
          </InterfaceText>
        </Text>
      ) : !value && !loadError ? (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          <InterfaceText>{'Loading computer preferences…'}</InterfaceText>
        </Text>
      ) : null}
      {!!loadError && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={styles.error}>
            {loadError}
          </Text>
          <Action
            wide
            secondary
            label={uiText('Retry computer preferences')}
            disabled={!connected || busy}
            onPress={() => setRetry(retry + 1)}
          />
        </View>
      )}
      {busy && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          <InterfaceText>{'Saving computer preferences…'}</InterfaceText>
        </Text>
      )}
      {saved && !busy && !error && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          <InterfaceText>{'Computer preferences saved.'}</InterfaceText>
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {value && (
        <>
          {show('tasks') && (
            <Section title={uiText('Prompt suggestions')}>
              <SettingsSwitchRow
                first
                label={uiText('Tab completion')}
                value={value.suggestNextPrompt}
                disabled={disabled || snapshot?.promptSuggestionsEnabled === undefined}
                onValueChange={(suggestNextPrompt) => save({ suggestNextPrompt })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                <InterfaceText>
                  {
                    'Suggest a next prompt after a Claude or Codex turn. Tap the suggestion to insert it without sending. On desktop, press Tab to insert it or Escape to dismiss it. Each suggestion makes an extra model request and uses plan usage.'
                  }
                </InterfaceText>
              </Text>
            </Section>
          )}
          {show('tasks') && (
            <Section title={uiText('Running tasks')}>
              <Choice
                label={uiText('Scheduled worker capacity')}
                value={String(value?.maxConcurrentWorkers ?? 0)}
                disabled={disabled}
                items={[0, 2, 4, 8, 16, 32].map((limit) => ({
                  id: String(limit),
                  name: limit === 0 ? 'Automatic' : String(limit),
                }))}
                onChange={(limit) => save({ maxConcurrentWorkers: Number(limit) })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                <InterfaceText>
                  {
                    'Scheduled jobs wait at this threshold. One slot stays available for conversation work. Direct messages and needed children can exceed it. Running work is kept.'
                  }
                </InterfaceText>
              </Text>
              <ChildAgentLimit
                value={value?.maxActiveChildAgents}
                disabled={disabled}
                onSave={(maxActiveChildAgents) => save({ maxActiveChildAgents })}
              />
              <View style={{ gap: 6 }}>
                <SettingsSwitchRow
                  first
                  label={uiText('Continue interrupted turns after runtime restart')}
                  value={value?.autoContinueAfterRestart ?? false}
                  disabled={disabled}
                  onValueChange={(autoContinueAfterRestart) => save({ autoContinueAfterRestart })}
                />
                <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                  <InterfaceText>
                    {
                      'Interrupted turns can resume automatically. Queued messages stay paused until you resume them. Stopped tasks and automations still require Retry.'
                    }
                  </InterfaceText>
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                <Choice
                  label={uiText('Auto-archive inactive tasks')}
                  value={String(value?.autoArchiveDays ?? 0)}
                  disabled={disabled}
                  items={[
                    { id: '0', name: uiText('Never') },
                    { id: '7', name: uiText('After 7 days') },
                    { id: '14', name: uiText('After 14 days') },
                    { id: '30', name: uiText('After 30 days') },
                  ]}
                  onChange={(days) =>
                    save({
                      autoArchiveDays: decode(
                        runtimePreferencesSchema.fields.autoArchiveDays,
                        Number(days),
                      ),
                    })
                  }
                />
                <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                  <InterfaceText>
                    {
                      'Computer fallback when no scoped archiving rule is set. Scoped On archives after time in Settled; scoped Off disables automatic archiving. Running, waiting, pinned tasks and open terminals are protected.'
                    }
                  </InterfaceText>
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                <SettingsSwitchRow
                  first
                  label={uiText('Keep this computer awake while tasks run')}
                  value={value?.preventSleepWhileRunning ?? false}
                  disabled={disabled}
                  onValueChange={(preventSleepWhileRunning) => save({ preventSleepWhileRunning })}
                />
                <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                  <InterfaceText>
                    {
                      'macOS only. Prevents idle sleep while a task is working, so it keeps going while you follow it here.'
                    }
                  </InterfaceText>
                </Text>
              </View>
            </Section>
          )}
          {show('tasks') && (
            <Section
              title={uiText('Model modes (experimental)')}
              advanced
              searchLabels={['Tune & Maestro modes (experimental)']}
            >
              <SettingsSwitchRow
                first
                label={uiText('Tune & Maestro modes (experimental)')}
                value={value.enableSmartModelSelection}
                disabled={disabled || snapshot?.smartModelSelectionEnabled === undefined}
                onValueChange={(enableSmartModelSelection) => save({ enableSmartModelSelection })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                <InterfaceText>
                  {
                    'Tune chooses a model within the default agent. Maestro chooses the agent and model together. Both choose reasoning once before the first turn. Inherit keeps project defaults.'
                  }
                </InterfaceText>
              </Text>
            </Section>
          )}
          {show('tasks') && (
            <Section
              title={uiText('Project mode (experimental)')}
              advanced
              searchLabels={['Scope mode (experimental)', 'Scope model mode']}
            >
              <SettingsSwitchRow
                first
                label={uiText('Scope mode (experimental)')}
                value={value.enableAutoProjectSelection}
                disabled={disabled || snapshot?.autoProjectSelectionEnabled === undefined}
                onValueChange={(enableAutoProjectSelection) => save({ enableAutoProjectSelection })}
              />
              {value.enableAutoProjectSelection && (
                <Choice
                  label={uiText('Scope model mode')}
                  value={value.autoProjectModelSelection}
                  disabled={disabled}
                  items={[
                    { id: 'inherit', name: uiText('Inherit') },
                    ...(value.enableSmartModelSelection
                      ? [
                          { id: 'auto', name: 'Tune', icon: 'tune' as const },
                          { id: 'smart', name: 'Maestro', icon: 'maestro' as const },
                        ]
                      : []),
                  ]}
                  onChange={(mode) =>
                    save({ autoProjectModelSelection: decode(taskModelSelectionSchema, mode) })
                  }
                />
              )}

              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                <InterfaceText>
                  {
                    'Find primary and linked projects from the first message on this computer. If no project matches, continue without a project.'
                  }
                </InterfaceText>
              </Text>
            </Section>
          )}
          {show('tasks') && (
            <Section title={uiText('Supervised mode')}>
              <SettingsSwitchRow
                first
                label={uiText('Always allow web requests on this computer')}
                value={value.allowWebRequests}
                disabled={disabled || !webRulesSupported}
                onValueChange={(allowWebRequests) => save({ allowWebRequests })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                {webRulesSupported
                  ? uiText(
                      'Allows browsing and search in every project and thread on this computer. Shell commands and file changes keep their existing approvals.',
                    )
                  : uiText('Update Dovo on this computer to use web approval rules.')}
              </Text>
            </Section>
          )}
          {show('tools') && (
            <Section title={uiText('Agent tools')}>
              <SettingsSwitchRow
                first
                label={uiText('Linked projects tool')}
                value={value?.enableLinkedProjectsTool ?? true}
                disabled={disabled}
                onValueChange={(enableLinkedProjectsTool) => save({ enableLinkedProjectsTool })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                <InterfaceText>
                  {
                    'Let agents discover projects and stage links for their own thread’s next turn. Existing links and manual linking are unaffected. Disabling blocks calls immediately; tool visibility updates next turn.'
                  }
                </InterfaceText>
              </Text>
            </Section>
          )}
          {show('tasks') && (
            <Section title={uiText('Code reviews (experimental)')}>
              <SettingsSwitchRow
                first
                label={uiText('Enable experimental code reviews')}
                value={value?.enableCodeReviews ?? false}
                disabled={disabled}
                onValueChange={(enableCodeReviews) => save({ enableCodeReviews })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                <InterfaceText>
                  {
                    'Opt in to agent reviews, findings, verification and optional review approval on this computer. Review is never required to commit or push.'
                  }
                </InterfaceText>
              </Text>
            </Section>
          )}
          {show('pulls') && (
            <Section title={uiText('Pull requests & pipelines')}>
              <View style={{ gap: 6 }}>
                <SettingsSwitchRow
                  first
                  label={uiText('Smart PR linking')}
                  value={value?.autoLinkPullRequests ?? true}
                  disabled={disabled}
                  onValueChange={(autoLinkPullRequests) => save({ autoLinkPullRequests })}
                />
                <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                  <InterfaceText>
                    {'Links branch matches and verified PR URLs mentioned in messages.'}
                  </InterfaceText>
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                <SettingsSwitchRow
                  first
                  label={uiText('Settle when the PR closes')}
                  value={value?.settleOnPullClose ?? false}
                  disabled={disabled}
                  onValueChange={(settleOnPullClose) => save({ settleOnPullClose })}
                />
                <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                  <InterfaceText>
                    {
                      'Moves the thread to Settled when its main PR is merged or closed. Pinned threads and active or queued work stay put.'
                    }
                  </InterfaceText>
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                <SettingsSwitchRow
                  first
                  label={uiText('Archive tasks when their PR closes')}
                  value={value?.archiveOnPullMerge ?? false}
                  disabled={disabled}
                  onValueChange={(archiveOnPullMerge) => save({ archiveOnPullMerge })}
                />
                <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                  <InterfaceText>
                    {
                      'Archives a task once its pull request is merged or closed. Pinned and busy tasks stay.'
                    }
                  </InterfaceText>
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                <SettingsSwitchRow
                  first
                  label={uiText('Enable experimental PR feedback watcher')}
                  value={value?.enablePullRequestWatching ?? false}
                  disabled={disabled}
                  onValueChange={(enablePullRequestWatching) => save({ enablePullRequestWatching })}
                />
                <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                  <InterfaceText>
                    {
                      'Let agents hand PR monitoring to this computer. New comments, reviews and failing checks wake the thread. Finished watched threads move to Waiting. Paused queues stay paused; settling or archiving cancels watches.'
                    }
                  </InterfaceText>
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                <SettingsSwitchRow
                  first
                  label={uiText('PR babysitting')}
                  value={
                    !!value?.enablePullRequestWatching && !!value?.enablePullRequestBabysitting
                  }
                  disabled={disabled}
                  onValueChange={(enablePullRequestBabysitting) =>
                    save({
                      enablePullRequestBabysitting,
                      ...(enablePullRequestBabysitting ? { enablePullRequestWatching: true } : {}),
                    })
                  }
                />
                <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                  <InterfaceText>
                    {
                      'Maintain the PR for an editing thread. Fix CI and review feedback, test and push fixes, and use GitHub Update branch to stay current. Merge approval stays manual. This uses agent tokens. Stop a PR watch to opt out for that thread.'
                    }
                  </InterfaceText>
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                <SettingsSwitchRow
                  first
                  label={uiText('Enable experimental pipeline watcher')}
                  value={value?.enablePipelineWatching ?? false}
                  disabled={disabled}
                  onValueChange={(enablePipelineWatching) => save({ enablePipelineWatching })}
                />
                <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                  <InterfaceText>
                    {
                      'Let agents hand pipeline monitoring to this computer. Failed runs wake the thread; successful runs finish silently. Finished watched threads move to Waiting. Paused queues stay paused; settling or archiving cancels watches.'
                    }
                  </InterfaceText>
                </Text>
              </View>
            </Section>
          )}
          {show('tools') && (
            <Section title={uiText('Shared GitHub and Jira retrieval')}>
              <SettingsSwitchRow
                first
                label={uiText('Share retrieval with paired computers')}
                value={value?.enableSharedRetrieval ?? true}
                disabled={disabled}
                onValueChange={(enableSharedRetrieval) => save({ enableSharedRetrieval })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                <InterfaceText>
                  {
                    "PRs use this machine's configured accounts by default. A preferred retrieval computer must have the same account and repository access. If it is offline, saved PRs remain visible and actions wait for reconnection. Credentials stay on their computer."
                  }
                </InterfaceText>
              </Text>
              <Choice
                label={uiText('Preferred retrieval computer')}
                value={value?.preferredRetrievalHost || 'auto'}
                disabled={disabled || value?.enableSharedRetrieval === false}
                items={[
                  { id: 'auto', name: uiText('Automatic') },
                  ...overviews.flatMap((entry) =>
                    entry.profile.connection.runtimeId
                      ? [{ id: entry.profile.connection.runtimeId, name: entry.profile.name }]
                      : [],
                  ),
                ]}
                onChange={(preferredRetrievalHost) =>
                  save({
                    preferredRetrievalHost:
                      preferredRetrievalHost === 'auto' ? '' : preferredRetrievalHost,
                  })
                }
              />
            </Section>
          )}
          {show('tools') && snapshot?.remoteDesktopEnabled !== undefined && (
            <Section title={uiText('Remote desktop (experimental)')}>
              <Action
                label={uiText('Connect to desktop')}
                disabled={!connected || !snapshot?.remoteDesktopEnabled}
                onPress={() => setDesktopOpen(true)}
              />
              {desktopOpen && (
                <MobileRemoteDesktop key={activeId} onClose={() => setDesktopOpen(false)} />
              )}
              <SettingsSwitchRow
                first
                label={uiText('Enable remote desktop')}
                value={value?.enableRemoteDesktop ?? false}
                disabled={disabled}
                onValueChange={(enableRemoteDesktop) => save({ enableRemoteDesktop })}
              />
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                <InterfaceText>
                  {
                    'Allow paired devices to view this computer’s primary display. Requires Cua Driver and host OS permissions. Turning this off ends sharing.'
                  }
                </InterfaceText>
              </Text>
            </Section>
          )}
          {show('tools') && (
            <Section title={uiText('Studio Tools (experimental)')}>
              {snapshot?.studioPeerRegistrationEnabled !== undefined && (
                <View style={{ gap: 6 }}>
                  <SettingsSwitchRow
                    first
                    label={uiText(studioPeerAccessSetting.label)}
                    value={
                      value?.enableStudioPeerRegistration ?? snapshot.studioPeerRegistrationEnabled
                    }
                    disabled={disabled}
                    onValueChange={(enableStudioPeerRegistration) =>
                      save({ enableStudioPeerRegistration })
                    }
                  />
                  <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                    <InterfaceText>{studioPeerAccessSetting.description}</InterfaceText>
                  </Text>
                </View>
              )}
              {studioToolSettings.map(({ key, label, description }) => (
                <View key={key} style={{ gap: 6 }}>
                  <SettingsSwitchRow
                    first
                    label={label}
                    value={value?.[key] ?? false}
                    disabled={disabled}
                    onValueChange={(enabled) => save({ [key]: enabled })}
                  />
                  <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                    {description}
                  </Text>
                </View>
              ))}
            </Section>
          )}
          {show('artifacts') && (
            <Section title={uiText('Artifacts')}>
              <View style={{ gap: 6 }}>
                <SettingsSwitchRow
                  first
                  label={uiText('Enable Dovo Artifacts')}
                  value={value?.enableArtifacts ?? false}
                  disabled={disabled}
                  onValueChange={(enableArtifacts) => save({ enableArtifacts })}
                />
                <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                  <InterfaceText>
                    {
                      'Let agents create documents, diagrams, code and interactive previews inside threads. Shared by desktop and mobile for this computer.'
                    }
                  </InterfaceText>
                </Text>
              </View>
              {(['settledArtifactRetention', 'archivedArtifactRetention'] as const).map((key) => (
                <Choice
                  key={key}
                  label={
                    key === 'settledArtifactRetention'
                      ? uiText('Artifacts when settled')
                      : uiText('Artifacts when archived')
                  }
                  disabled={disabled}
                  value={value?.[key] ?? 'forever'}
                  items={artifactRetentionChoices.map((choice) => ({
                    id: choice.value,
                    name: choice.label,
                  }))}
                  onChange={(policy) => save({ [key]: decode(artifactRetentionSchema, policy) })}
                />
              ))}
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                <InterfaceText>
                  {
                    'Applies to existing artifacts and all versions, even when disabled. Deletion is permanent. The archived rule takes priority; reopening or restoring resets the state’s timer.'
                  }
                </InterfaceText>
              </Text>
            </Section>
          )}
          {show('memory') && (
            <Section title={uiText('Memory')}>
              <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                <InterfaceText>
                  {
                    'Optional notes stored locally on this computer and shared across its threads. Each scope starts off. Disabling a scope keeps its notes and stops agent access. Manage saved notes in desktop Settings → Tasks & projects → Memory.'
                  }
                </InterfaceText>
              </Text>
              {(
                [
                  {
                    scope: 'system',
                    label: uiText('System-wide memory'),
                    enabled: value?.memory.systemEnabled ?? false,
                  },
                  {
                    scope: 'projectless',
                    label: uiText('Memory for threads without a project'),
                    enabled: value?.memory.projectlessEnabled ?? false,
                  },
                ] as const
              ).map((item) => (
                <SettingsSwitchRow
                  key={item.scope}
                  first
                  label={item.label}
                  value={item.enabled}
                  disabled={disabled}
                  onValueChange={(enabled) => configureMemory(item.scope, enabled)}
                />
              ))}
              {!!memoryError && (
                <View style={{ gap: 8 }}>
                  <Text accessibilityRole="alert" style={styles.error}>
                    <InterfaceText values={{ value0: memoryError }}>
                      {'Project memory settings could not be loaded: {value0}'}
                    </InterfaceText>
                  </Text>
                  <Action
                    wide
                    secondary
                    label={uiText('Retry project memory settings')}
                    disabled={disabled}
                    onPress={() => setRetry(retry + 1)}
                  />
                </View>
              )}
              {memoryLoading && (
                <Text accessibilityLiveRegion="polite" style={[styles.muted, { padding: 16 }]}>
                  <InterfaceText>{'Loading project memory settings…'}</InterfaceText>
                </Text>
              )}
              {!memoryLoading && !memoryError && !memoryProjects.length && (
                <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                  <InterfaceText>
                    {
                      'No project memory scopes available. Add a project on this computer to configure its memory.'
                    }
                  </InterfaceText>
                </Text>
              )}
              {memoryProjects.map((project) => (
                <SettingsSwitchRow
                  key={project.id}
                  first
                  label={uiText('Memory for {value0}{value1}', {
                    value0: project.name,
                    value1: !project.registered ? ' · Project removed' : '',
                  })}
                  value={value?.memory.projectRepositoryIds.includes(project.id) ?? false}
                  disabled={
                    disabled ||
                    (!project.registered &&
                      !value?.memory.projectRepositoryIds.includes(project.id))
                  }
                  onValueChange={(enabled) => configureMemory('project', enabled, project.id)}
                />
              ))}
            </Section>
          )}
          {show('worktrees') && (
            <Section title={uiText('Worktrees')}>
              <View style={{ padding: 16, gap: 8 }}>
                <Field
                  label={uiText('Branch prefix')}
                  placeholder={uiText('none')}
                  autoCorrect={false}
                  autoCapitalize="none"
                  editable={!disabled}
                  value={prefixDraft ?? value?.branchPrefix ?? ''}
                  onChangeText={(prefix) => {
                    setPrefixDraft(prefix)
                    setSaved(false)
                  }}
                  returnKeyType="done"
                  hint={uiText(
                    'New task branches look like {value0}fix-login-1a2b3c4d. Leave empty for none.',
                    { value0: branchPrefix.prefix },
                  )}
                  error={
                    branchPrefix.valid
                      ? undefined
                      : 'Use letters, numbers, dots, dashes or underscores.'
                  }
                />
                {prefixDraft !== null && prefixDraft !== value.branchPrefix && (
                  <Action
                    wide
                    label={uiText('Save branch prefix')}
                    disabled={disabled || !branchPrefix.valid}
                    onPress={commitPrefix}
                  />
                )}
              </View>
              <View style={{ gap: 6 }}>
                <SettingsSwitchRow
                  first
                  label={uiText('Remove worktrees of archived tasks')}
                  value={value?.removeArchivedWorktrees ?? false}
                  disabled={disabled}
                  onValueChange={(removeArchivedWorktrees) => save({ removeArchivedWorktrees })}
                />
                <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                  <InterfaceText>
                    {
                      'Worktrees with uncommitted changes are kept. The branch stays, so restoring a task checks it out again. Ignored local files are deleted with the checkout.'
                    }
                  </InterfaceText>
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                <SettingsSwitchRow
                  first
                  label={uiText('Remove worktrees when deleting their last thread')}
                  value={value?.removeWorktreesOnThreadDelete ?? false}
                  disabled={disabled}
                  onValueChange={(removeWorktreesOnThreadDelete) =>
                    save({ removeWorktreesOnThreadDelete })
                  }
                />
                <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                  <InterfaceText>
                    {
                      'Only clean Dovo-created checkouts with no remaining threads are removed. Branches and uncommitted changes are kept. Ignored local files are deleted with the checkout.'
                    }
                  </InterfaceText>
                </Text>
              </View>
            </Section>
          )}
          {show('activity') && (
            <Section title={uiText('Activity')}>
              {snapshot?.freezeProfilesSupported && (
                <View style={{ gap: 6 }}>
                  <SettingsSwitchRow
                    label={uiText('Capture repeated freezes')}
                    value={value?.enableFreezeProfiles ?? false}
                    disabled={disabled}
                    onValueChange={(enableFreezeProfiles) => save({ enableFreezeProfiles })}
                  />
                  <Text style={styles.muted}>
                    <InterfaceText>
                      {
                        'After two busy stalls, sample CPU work for two seconds. Keep three local summaries without source paths or user code. At most once per ten minutes. Off by default.'
                      }
                    </InterfaceText>
                  </Text>
                </View>
              )}
              <View style={{ gap: 6 }}>
                <Choice
                  label={uiText('Keep activity history')}
                  value={String(value?.activityRetentionDays ?? 90)}
                  disabled={disabled}
                  items={[
                    { id: '0', name: uiText('Forever') },
                    { id: '365', name: uiText('For 1 year') },
                    { id: '90', name: uiText('For 90 days') },
                    { id: '30', name: uiText('For 30 days') },
                  ]}
                  onChange={(days) =>
                    save({
                      activityRetentionDays: decode(
                        runtimePreferencesSchema.fields.activityRetentionDays,
                        Number(days),
                      ),
                    })
                  }
                />
                <Text style={[styles.muted, { paddingHorizontal: 16, paddingBottom: 12 }]}>
                  <InterfaceText values={{ value0: DIAGNOSTIC_RETENTION_DAYS }}>
                    {
                      'Older requests and tool details are deleted from this computer. Task conversations are kept. CLI diagnostics and raw provider events expire after {value0} days, including when activity history is kept forever. Successful Git and GitHub reads are not recorded.'
                    }
                  </InterfaceText>
                </Text>
              </View>
            </Section>
          )}
        </>
      )}
    </View>
  )
}

function Section(props: {
  title: string
  children: ReactNode
  advanced?: boolean
  searchLabels?: readonly string[]
}) {
  return <SettingsGroup {...props} />
}

function ChildAgentLimit({
  value,
  disabled,
  onSave,
}: {
  value: number | undefined
  disabled: boolean
  onSave: (value: number) => void
}) {
  const uiText = useInterfaceText()

  const [draft, setDraft] = useApplicationState<string | null>(null)
  useSettingsDraft(draft !== null && draft !== String(value ?? 4))
  const limit = Number(draft ?? value ?? 4)
  const valid = Number.isSafeInteger(limit) && limit >= 1
  useEffect(() => {
    if (draft !== null && valid && limit === value) setDraft(null)
  }, [draft, valid, limit, value, setDraft])
  const commit = () => {
    if (draft !== null && valid && limit !== value) onSave(limit)
  }
  return (
    <View style={{ gap: 8, padding: 16 }}>
      <Field
        label={uiText('Maximum concurrent child agents')}
        keyboardType="number-pad"
        value={draft ?? String(value ?? 4)}
        editable={!disabled}
        onChangeText={setDraft}
        returnKeyType="done"
        hint={uiText(
          'Per parent thread on this computer. Extra launches are refused until a child finishes; existing children keep running when the limit is lowered. Default: 4.',
        )}
        error={valid ? undefined : 'Enter a whole number of at least 1.'}
      />
      {draft !== null && limit !== value && (
        <Action
          wide
          label={uiText('Save child agent limit')}
          disabled={disabled || !valid}
          onPress={commit}
        />
      )}
    </View>
  )
}
