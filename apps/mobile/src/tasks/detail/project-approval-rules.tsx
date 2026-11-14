import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
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
  const uiText = useInterfaceText()

  const { snapshot, connected, callEffect } = useRuntime()
  const { styles } = useTheme()
  const { act, busy, error } = useAction()
  const project = snapshot?.workspace.repositories.find((item) => item.id === repositoryId)
  const webRulesSupported = snapshot?.allowWebRequests !== undefined
  return (
    <Sheet title={uiText('Project approval rules')} busy={busy} onClose={onClose}>
      <Text style={styles.muted}>
        <InterfaceText
          values={{
            value0: !webRulesSupported
              ? uiText('Update Dovo on this computer to use web approval rules.')
              : snapshot?.allowWebRequests
                ? uiText(
                    'Web requests are always allowed on this computer. Change that in computer preferences before changing the project rule.',
                  )
                : uiText('Web browsing and search {value0} in {value1}.', {
                    value0: project?.approvedWebRequests
                      ? 'are always allowed'
                      : 'ask for approval',
                    value1: project?.name ?? 'this project',
                  }),
          }}
        >
          {'{value0} Shell commands and file changes keep their existing approval rules.'}
        </InterfaceText>
      </Text>
      <Action
        label={
          project?.approvedWebRequests
            ? uiText('Ask before web requests')
            : uiText('Always allow web requests')
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
