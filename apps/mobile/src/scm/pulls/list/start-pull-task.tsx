import { mobileWorkflow } from '../../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Text } from '../../../ui/content/text'
import { pullTaskResponse, type PullDetail } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { useNavigation } from '../../../shell/navigation'
import { Action } from '../../../ui/controls/action'
import { useTheme } from '../../../ui/theme'
import { useAction } from '../../../ui/controls/use-action'
import { Sheet } from '../../../ui/layout/sheet'
export function StartPullTask({
  repositoryId,
  pull,
  onBack,
  stackAction,
}: {
  repositoryId: string
  pull: PullDetail['pull']
  onBack: () => void
  stackAction?: 'update'
}) {
  const { styles } = useTheme()

  const { connected, callEffect } = useRuntime(),
    { navigate } = useNavigation(),
    { busy, error, act } = useAction()
  const create = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        const result = yield* callEffect(
          '/api/scm/pulls/task',
          {
            repositoryId,
            number: pull.number,
            headSha: pull.headSha,
            objective: stackAction
              ? 'Update the stack, restack branches and update PRs.'
              : 'Review this PR for correctness, regressions, and missing tests. Report concrete findings without changing files.',
            run: false,
            stackAction,
          },
          pullTaskResponse,
        )
        onBack()
        navigate('tasks', result.id)
      }),
    )
  }
  return (
    <Sheet
      title={stackAction ? 'Update PR stack' : `Task from PR #${pull.number}`}
      onClose={onBack}
      busy={busy}
    >
      <Text
        style={[
          styles.text,
          {
            fontWeight: '600',
          },
        ]}
      >
        {pull.title}
      </Text>
      <Text style={styles.muted}>
        {stackAction
          ? 'The draft includes fresh stack dependencies and instructions to restack branches and update PRs.'
          : 'The draft includes the PR description and review feedback.'}{' '}
        A worktree is prepared from commit {pull.headSha.slice(0, 8)} when you send it.
      </Text>
      <Text style={styles.muted}>
        Choose an agent and model, then edit and send the first message in chat.
      </Text>
      <Action label="Open draft" disabled={busy || !connected} onPress={() => act(create)} />
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </Sheet>
  )
}
