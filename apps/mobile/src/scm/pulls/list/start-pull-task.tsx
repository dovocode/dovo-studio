import { mobileWorkflow } from '../../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { pullTaskResponse, type PullDetail } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { useNavigation } from '../../../shell/navigation'
import { useAction } from '../../../ui/controls/use-action'

export function usePullTaskCreation(repositoryId: string, pull: PullDetail['pull'] | undefined) {
  const { connected, callEffect } = useRuntime()
  const { navigate } = useNavigation()
  const action = useAction()
  const start = (checkoutMode: 'new-branch' | 'pr-branch', stackAction?: 'update') => {
    if (!pull || !connected || action.busy) return
    action.act(() =>
      runClientEffect(
        mobileWorkflow(function* () {
          const result = yield* callEffect(
            '/api/scm/pulls/task',
            {
              repositoryId,
              number: pull.number,
              headSha: pull.headSha,
              objective: stackAction
                ? 'Update the stack, restack branches and update PRs.'
                : 'I want to work on this PR.',
              run: false,
              stackAction,
              checkoutMode,
            },
            pullTaskResponse,
          )
          navigate('tasks', result.id)
        }),
      ),
    )
  }
  return { ...action, start }
}
