import { Text } from '../ui/text'
import { pullTaskResponse, type PullDetail } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { useNavigation } from '../shell/navigation'
import { Action } from '../ui/action'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
import { Sheet } from '../ui/sheet'
export function StartPullTask({
  repositoryId,
  pull,
  onBack,
}: {
  repositoryId: string
  pull: PullDetail['pull']
  onBack: () => void
}) {
  const { call, connected } = useRuntime(),
    { navigate } = useNavigation(),
    { busy, error, act } = useAction()
  const create = async () => {
    const result = await call(
      '/api/scm/pulls/task',
      {
        repositoryId,
        number: pull.number,
        headSha: pull.headSha,
        objective:
          'Review this PR for correctness, regressions, and missing tests. Report concrete findings without changing files.',
        run: false,
      },
      pullTaskResponse,
    )
    onBack()
    navigate('tasks', result.id)
  }
  return (
    <Sheet title={`Task from PR #${pull.number}`} onClose={onBack} busy={busy}>
      <Text style={[styles.text, { fontWeight: '600' }]}>{pull.title}</Text>
      <Text style={styles.muted}>
        The draft includes the PR description and review feedback, with a worktree prepared from
        commit {pull.headSha.slice(0, 8)} when you send it.
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
