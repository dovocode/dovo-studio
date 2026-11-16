import { mobileWorkflow, nativeEffect } from '../../../runtime/state/native-effect'
import { useState } from 'react'
import { pullReviewRepositories, resolvePullReviewSource } from '@dovo/studio-core/pull-code-review'
import { runClientEffect } from '@dovo/client-runtime'
import { pullTaskResponse, type PullDetail } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { useNavigation } from '../../../shell/navigation'
import { useSheetNavigation } from '../../../ui/layout/sheet'
import { useAction } from '../../../ui/controls/use-action'

export function usePullTaskCreation(repositoryId: string, pull: PullDetail['pull'] | undefined) {
  const { connected, callEffect, activeId, overviews, readRuntimeEffect } = useRuntime()
  const [chosenComputer, setChosenComputer] = useState('')
  const [chosenProject, setChosenProject] = useState('')
  const computerId = chosenComputer || activeId || ''
  const computer = overviews.find((entry) => entry.profile.id === computerId)
  const remote = computerId !== activeId
  const projects =
    remote && pull
      ? pullReviewRepositories(pull.url, computer?.snapshot?.workspace.repositories ?? [])
      : []
  const projectId = projects.some((project) => project.id === chosenProject)
    ? chosenProject
    : projects.length === 1
      ? projects[0].id
      : ''
  const { navigate } = useNavigation()
  const action = useAction()
  const navigateAfterSheet = useSheetNavigation()
  const start = (checkoutMode: 'new-branch' | 'pr-branch', stackAction?: 'update') => {
    if (!pull || !computerId || action.busy) return
    action.act(() =>
      runClientEffect(
        mobileWorkflow(function* () {
          if (remote && (!computer?.connected || !projectId))
            throw new Error(
              !computer?.connected
                ? 'Computer offline'
                : projects.length
                  ? 'Choose a project on this computer.'
                  : 'Open this repository as a project on this computer first.',
            )
          if (!remote && !connected) throw new Error('Computer offline')
          const targetCall: typeof callEffect =
            remote && computer
              ? (path, input, schema, method, options) =>
                  readRuntimeEffect(computer.profile, path, input, schema, method, options)
              : callEffect
          const source = remote
            ? yield* nativeEffect(() =>
                resolvePullReviewSource({
                  detail: { pull },
                  repositoryId: projectId,
                  request: (path, input, schema, method) =>
                    runClientEffect(targetCall(path, input, schema, method)),
                  remember: () => {},
                }),
              )
            : undefined
          const sourcePull = source?.pull ?? pull
          const result = yield* targetCall(
            '/api/scm/pulls/task',
            {
              repositoryId: remote ? projectId : repositoryId,
              number: sourcePull.number,
              headSha: sourcePull.headSha,
              expectedDestination: source?.destination ?? sourcePull.destination,
              connectionId: sourcePull.connectionId,
              objective: stackAction
                ? 'Update the stack, restack branches and update PRs.'
                : 'I want to work on this PR.',
              run: false,
              stackAction,
              checkoutMode,
            },
            pullTaskResponse,
          )
          navigateAfterSheet(() => navigate('tasks', result.id, computerId))
        }),
      ),
    )
  }
  return {
    ...action,
    start,
    computerId,
    projectId,
    projects,
    computers: overviews.map((entry) => ({
      id: entry.profile.id,
      name: entry.profile.name,
      disabled: entry.profile.id === activeId ? !connected : !entry.connected,
    })),
    chooseComputer: (id: string) => {
      setChosenComputer(id)
      setChosenProject('')
    },
    chooseProject: setChosenProject,
    available: connected || overviews.some((entry) => entry.connected),
  }
}
