import { mobileWorkflow } from '../runtime/native-effect'
import { useApplicationState } from '../runtime/application-state'
import { View } from 'react-native'
import { responses } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { Choice } from '../ui/choice'
import { Sheet } from '../ui/sheet'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
export function JiraIssueProject({
  sourceId,
  issueId,
  disabled,
}: {
  sourceId: string
  issueId: string
  disabled: boolean
}) {
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
      <Text style={styles.muted}>Dovo project · {project?.name ?? 'Not linked'}</Text>
      <Action
        secondary
        label={project ? 'Change linked project' : 'Link a project'}
        disabled={disabled || busy}
        onPress={() => {
          setSelected(project?.id ?? '')
          setOpen(true)
        }}
      />
      {open && (
        <Sheet title="Link a Dovo project" busy={busy} onClose={() => setOpen(false)}>
          <Text style={styles.muted}>
            This link is saved in Dovo. The Jira issue and its fields stay unchanged.
          </Text>
          <Choice
            label="Project"
            value={selected}
            onChange={setSelected}
            disabled={busy}
            items={[
              {
                id: '',
                name: 'No project',
              },
              ...projects.map((project) => ({
                id: project.id,
                name: project.name,
              })),
            ]}
          />
          {!projects.length && (
            <Text style={styles.muted}>
              Add a project to this computer when you are ready to start a task.
            </Text>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Action
            label={busy ? 'Saving…' : 'Save link'}
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
