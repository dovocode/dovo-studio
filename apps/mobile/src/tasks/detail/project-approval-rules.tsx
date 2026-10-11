import { Effect } from 'effect'
import { workspacePatchResultSchema } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { useAction } from '../../ui/controls/use-action'
import { Sheet } from '../../ui/layout/sheet'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function ProjectApprovalRules({
  repositoryId,
  onClose,
}: {
  repositoryId: string
  onClose: () => void
}) {
  const { snapshot, connected, callEffect } = useRuntime()
  const { styles } = useTheme()
  const { act, busy, error } = useAction()
  const project = snapshot?.workspace.repositories.find((item) => item.id === repositoryId)
  const webRulesSupported = snapshot?.allowWebRequests !== undefined
  return (
    <Sheet title="Project approval rules" busy={busy} onClose={onClose}>
      <Text style={styles.muted}>
        {!webRulesSupported
          ? 'Update Dovo on this computer to use web approval rules.'
          : snapshot?.allowWebRequests
            ? 'Web requests are always allowed on this computer. Change that in computer preferences before changing the project rule.'
            : `Web browsing and search ${project?.approvedWebRequests ? 'are always allowed' : 'ask for approval'} in ${project?.name ?? 'this project'}.`}{' '}
        Shell commands and file changes keep their existing approval rules.
      </Text>
      <Action
        label={
          project?.approvedWebRequests ? 'Ask before web requests' : 'Always allow web requests'
        }
        disabled={
          !connected || busy || !project || !webRulesSupported || snapshot?.allowWebRequests
        }
        onPress={() =>
          act(() =>
            callEffect(
              '/api/workspace',
              {
                collection: 'repositories',
                id: repositoryId,
                changes: {
                  approvedWebRequests: {
                    before: project?.approvedWebRequests ?? null,
                    after: !project?.approvedWebRequests,
                  },
                },
              },
              workspacePatchResultSchema,
              'PATCH',
            ).pipe(Effect.tap(() => Effect.sync(onClose))),
          )
        }
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </Sheet>
  )
}
