import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { projectDeletionPreview } from '@dovo/studio-core/project-deletion'
import { responses, runtimeComputerName, SCRATCH_PROJECT_ID, type Repository } from '@dovo/protocol'
import { Effect } from 'effect'
import { router } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Alert, View } from 'react-native'
import { mobileWorkflow, nativeEffect } from '../../runtime/state/native-effect'
import { useRuntime } from '../../runtime/connection/provider'
import { useApplicationState } from '../../runtime/state/application-state'
import { useNavigation } from '../../shell/navigation'
import { automationHref } from '../../shell/source-route'
import { useTaskListView } from '../../tasks/list/task-list-view'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { Sheet, type SheetHandle } from '../../ui/layout/sheet'
import { WorkMenu } from '../work/work-menu'
import { useAction } from '../../ui/controls/use-action'
import { useTheme } from '../../ui/theme'

export function DeleteProjectAction({ repository }: { repository: Repository }) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  const { connected, profile, snapshot, readRuntimeEffect, refreshRuntimeEffect } = useRuntime()
  const { navigate } = useNavigation()
  const { setView } = useTaskListView()
  const { busy, error, act } = useAction()
  const [confirmation, setConfirmation] = useApplicationState<{
    repositoryId: string
    runtimeId: string | undefined
  } | null>(null)
  const sheet = useRef<SheetHandle>(null)
  const open =
    confirmation?.repositoryId === repository.id && confirmation.runtimeId === profile?.id
  const { blockers } = open
    ? projectDeletionPreview(repository.id, snapshot?.workspace, snapshot)
    : { blockers: [] }
  const computer = runtimeComputerName({ profile, snapshot })
  const online = connected && !!profile
  useEffect(() => {
    setConfirmation(null)
  }, [profile?.id, repository.id, setConfirmation])

  const remove = () => {
    if (!open || busy || !connected || !profile || blockers.length) return
    act(() =>
      mobileWorkflow(function* () {
        yield* readRuntimeEffect(
          profile,
          '/api/scm/repositories/delete',
          { repositoryId: repository.id },
          responses.ok,
          'POST',
        )
        yield* nativeEffect(() => {
          setConfirmation(null)
          setView((current) => ({ ...current, project: 'scratch', source: 'all' }))
          navigate('tasks')
        })
        yield* refreshRuntimeEffect(profile).pipe(
          Effect.catch((cause) =>
            nativeEffect(() =>
              Alert.alert(
                uiText('Project deleted'),
                uiText(
                  'The project was removed from Dovo, but the project list could not refresh: {value0}',
                  { value0: cause instanceof Error ? cause.message : String(cause) },
                ),
              ),
            ),
          ),
        )
      }),
    )
  }

  if (repository.kind === 'scratch' || repository.id === SCRATCH_PROJECT_ID) return null

  return (
    <View style={{ gap: 4 }}>
      <View style={{ alignItems: 'flex-end' }}>
        <WorkMenu
          label={uiText('Actions for {value0}', { value0: repository.name })}
          actions={[
            {
              label: uiText('Delete project…'),
              disabled: busy,
              onPress: () =>
                setConfirmation({ repositoryId: repository.id, runtimeId: profile?.id }),
              destructive: true,
            },
          ]}
        />
      </View>
      {open && (
        <Sheet
          ref={sheet}
          title={uiText('Delete “{value0}”?', { value0: repository.name })}
          onClose={() => setConfirmation(null)}
          busy={busy}
        >
          <Text>
            {uiText('This deletion applies to {value0} only. You cannot undo it.', {
              value0: computer,
            })}
          </Text>
          <View>
            <Text accessibilityRole="header">{uiText('Will be removed')}</Text>
            <Text>
              {uiText(
                'The project entry and its thread history. Local artifact feeds for those threads stop.',
              )}
            </Text>
          </View>
          <View>
            <Text accessibilityRole="header">{uiText('Will change')}</Text>
            <Text>
              {uiText(
                'Dovo disables affected automations, moves project targets to General, and removes links to this checkout.',
              )}
            </Text>
          </View>
          <View>
            <Text accessibilityRole="header">{uiText('Will stay')}</Text>
            <Text>
              {uiText(
                'Files stay on disk. Other projects and their threads stay in Dovo. Hosted artifact copies remain.',
              )}
            </Text>
          </View>
          {!online && (
            <Text accessibilityLiveRegion="polite">
              {uiText('Connect to {value0} before deleting this project.', { value0: computer })}
            </Text>
          )}
          {!!blockers.length && (
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="header" accessibilityLiveRegion="polite">
                {uiText(online ? 'Deletion blocked' : 'Last known blockers')}
              </Text>
              {blockers.map((blocker) => (
                <View key={`${blocker.kind}:${blocker.id}`}>
                  {blocker.reasons.map((reason) => (
                    <Text key={reason}>{uiText(reason)}</Text>
                  ))}
                  {profile && (
                    <Action
                      secondary
                      disabled={busy}
                      label={uiText(
                        blocker.kind === 'thread'
                          ? 'Open thread: {value0}'
                          : 'Open automation run: {value0}',
                        { value0: blocker.name || blocker.id },
                      )}
                      onPress={() =>
                        sheet.current?.dismiss(() => {
                          if (blocker.kind === 'thread') navigate('tasks', blocker.id, profile.id)
                          else
                            router.push(
                              automationHref(profile.id, blocker.automationId, blocker.id),
                            )
                        })
                      }
                    />
                  )}
                </View>
              ))}
            </View>
          )}
          {online && !blockers.length && (
            <Text>{uiText('This computer checks for active work when you confirm.')}</Text>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Action
            secondary
            label={uiText('Cancel')}
            disabled={busy}
            onPress={() => sheet.current?.dismiss()}
          />
          {online && !blockers.length && (
            <Action
              label={uiText(busy ? 'Deleting…' : 'Delete project and history')}
              disabled={busy}
              destructive
              onPress={remove}
            />
          )}
        </Sheet>
      )}
    </View>
  )
}
