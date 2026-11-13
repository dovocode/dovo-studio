import { decode, workflowCommandSchema, taskWorkflows } from '@dovo/protocol'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'
import { targetedChildId } from '../studio/subagent-target.js'

/** Thread-owned workflow metadata. Child execution and permissions stay with delegation. */
export function workflowTool(s: Services, taskId: string, parentRunId: string, raw: unknown) {
  s.tasks.assertToolScope(taskId, parentRunId)
  const command = decode(workflowCommandSchema, raw)
  const task = s.store.taskSummary(taskId)
  const present = (workflow: ReturnType<typeof taskWorkflows>[number]) => ({
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    state: workflow.state,
    phases: workflow.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      state: phase.state,
      members: phase.members.map(({ agent: _agent, ...member }) => ({
        ...member,
        activity: member.activity?.slice(0, 1000),
        result: member.result?.slice(-2000),
      })),
    })),
  })
  if (command.action === 'list')
    return taskWorkflows(task, s.store.get().tasks).map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      state: workflow.state,
      phases: workflow.phases.length,
      members: workflow.members.length,
    }))
  if (command.action === 'create') {
    if (
      !command.id.trim() ||
      !command.name.trim() ||
      command.phases.some((phase) => !phase.id.trim() || !phase.title.trim())
    )
      throw new HttpError(400, 'Give the workflow and each phase a name and ID')
    if (new Set(command.phases.map((phase) => phase.id)).size !== command.phases.length)
      throw new HttpError(400, 'Phase IDs must be unique')
    const workflow = {
      id: command.id,
      name: command.name,
      description: command.description,
      phases: command.phases,
      members: [],
    }
    const previous = task.workflows?.find((item) => item.id === command.id)
    if (previous) {
      if (
        JSON.stringify([previous.name, previous.description, previous.phases]) !==
        JSON.stringify([workflow.name, workflow.description, workflow.phases])
      )
        throw new HttpError(409, 'This workflow ID was already used for a different plan')
    } else {
      if ((task.workflows?.length ?? 0) >= 50)
        throw new HttpError(409, 'This thread has reached its limit of 50 workflows')
      s.store.updateTask(taskId, (task) => ({
        ...task,
        workflows: [...(task.workflows ?? []), workflow],
      }))
    }
  } else {
    const workflow = task.workflows?.find((item) => item.id === command.id)
    if (command.action === 'attach') {
      if (!workflow) throw new HttpError(404, 'Workflow not found')
      if (!workflow.phases.some((phase) => phase.id === command.phaseId))
        throw new HttpError(404, 'Workflow phase not found')
      const child = s.store
        .get()
        .tasks.find(
          (child) => child.id === command.childId && child.delegation?.parentTaskId === taskId,
        )
      const watch = task.threadWatches?.find(
        (watch) => watch.delegated && targetedChildId(watch) === command.childId,
      )
      if (!child && !watch) throw new HttpError(403, 'Attach only a child owned by this thread')
      const previous = workflow.members.find((member) => member.id === command.childId)
      if (previous && previous.phaseId !== command.phaseId)
        throw new HttpError(409, 'This child already belongs to another phase')
      if (!previous) {
        if (workflow.members.length >= 200)
          throw new HttpError(409, 'This workflow has reached its limit of 200 members')
        const member = {
          id: command.childId,
          phaseId: command.phaseId,
          taskId: child?.id ?? watch?.threadId,
          runtimeId: watch?.runtimeId,
        }
        s.store.updateTask(taskId, (task) => ({
          ...task,
          workflows: task.workflows?.map((item) =>
            item.id === workflow.id ? { ...item, members: [...item.members, member] } : item,
          ),
        }))
      }
    }
  }
  const updated = s.store.taskSummary(taskId)
  const workflow = taskWorkflows(updated, s.store.get().tasks).find(
    (workflow) => workflow.id === command.id,
  )
  if (!workflow) throw new HttpError(404, 'Workflow not found')
  return present(workflow)
}
