import {
  lockedTaskProvider,
  providers,
  type Agent,
  type Task,
  type TaskHarness,
} from '@dovo/studio-core'

function checkSelection(task: Task, agents: readonly Agent[], provider: Agent['provider']) {
  if (task.status === 'running') throw new Error('Stop the current turn before changing its model.')
  if (task.archived) throw new Error('Reopen this task before changing its agent.')
  const locked = lockedTaskProvider(task, agents)
  if (locked && locked !== provider)
    throw new Error(
      `This conversation uses ${providers[locked].short}. Start a new task to use another provider.`,
    )
}

export function chooseTaskAgent(task: Task, agents: readonly Agent[], agentId: string): Task {
  const agent = agents.find((entry) => entry.id === agentId)
  if (!agent) throw new Error('This custom agent is no longer available. Choose another agent.')
  checkSelection(task, agents, agent.provider)
  if (!task.harness && task.agentId === agent.id) return task
  return { ...task, agentId: agent.id, harness: null, agentOverrides: undefined }
}

export function changeTaskHarness(
  task: Task,
  agents: readonly Agent[],
  harness: TaskHarness,
  standalone = false,
): Task {
  checkSelection(task, agents, harness.provider)
  const agent = !task.harness && agents.find((entry) => entry.id === task.agentId)
  if (!standalone && agent && agent.provider === harness.provider)
    return {
      ...task,
      harness: null,
      agentOverrides: {
        model: harness.model,
        reasoning: harness.reasoning ?? '',
        permission: harness.permission,
        serviceTier: harness.serviceTier ?? null,
        cyberAccessProgram: harness.cyberAccessProgram ?? null,
      },
    }
  return { ...task, harness, agentId: '', agentOverrides: undefined }
}
