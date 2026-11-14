import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { mobileWorkflow } from '../../runtime/state/native-effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { View } from 'react-native'
import { projectDisplayName, responses } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Choice } from '../../ui/controls/choice'
import { Sheet } from '../../ui/layout/sheet'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { useAction } from '../../ui/controls/use-action'
export function JiraIssueProject({
  sourceId,
  issueId,
  disabled,
}: {
  sourceId: string
  issueId: string
  disabled: boolean
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { snapshot, callEffect } = useRuntime()
  const { act, busy, error } = useAction()
  const [open, setOpen] = useApplicationState(false)
  const link = snapshot?.workspace.jiraIssueLinks?.find(
    (link) => link.sourceId === sourceId && link.issueId === issueId,
  )
  const projects = snapshot?.workspace.repositories ?? []
  const project = projects.find((project) => project.id === link?.repositoryId)
  const [selected, setSelected] = useApplicationState('')
  return (
    <View
      style={{
        gap: 6,
      }}
    >
      <Text style={styles.muted}>
        <InterfaceText values={{ value0: projectDisplayName(project, 'Not linked') }}>
          {'Dovo project · {value0}'}
        </InterfaceText>
      </Text>
      <Action
        secondary
        label={project ? uiText('Change linked project') : uiText('Link a project')}
        disabled={disabled || busy}
        onPress={() => {
          setSelected(project?.id ?? '')
          setOpen(true)
        }}
      />
      {open && (
        <Sheet title={uiText('Link a Dovo project')} busy={busy} onClose={() => setOpen(false)}>
          <Text style={styles.muted}>
            <InterfaceText>
              {'This link is saved in Dovo. The Jira issue and its fields stay unchanged.'}
            </InterfaceText>
          </Text>
          <Choice
            label={uiText('Project')}
            value={selected}
            onChange={setSelected}
            disabled={busy}
            items={[
              {
                id: '',
                name: uiText('No project'),
              },
              ...projects.map((project) => ({
                id: project.id,
                name: projectDisplayName(project),
              })),
            ]}
          />
          {!projects.length && (
            <Text style={styles.muted}>
              <InterfaceText>
                {'Add a project to this computer when you are ready to start a task.'}
              </InterfaceText>
            </Text>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Action
            label={busy ? uiText('Saving…') : uiText('Save link')}
            disabled={disabled || busy}
            onPress={() =>
              act(() =>
                mobileWorkflow(function* () {
                  yield* callEffect(
                    '/api/scm/jira/issues/link',
                    {
                      sourceId,
                      issueId,
                      repositoryId: selected || null,
                    },
                    responses.ok,
                  )
                  setOpen(false)
                }),
              )
            }
          />
        </Sheet>
      )}
    </View>
  )
}
