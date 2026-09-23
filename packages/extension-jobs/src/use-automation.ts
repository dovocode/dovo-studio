import { useApplicationState } from '@dovo/studio-core/state'
import { createTask, useWorkspace, type Automation } from '@dovo/studio-core'
import { validateGraph } from './graph'
export function useAutomation(automationId: string) {
  const { workspace, setWorkspace } = useWorkspace()
  const [selectedNode, selectNode] = useApplicationState<string | null>(null)
  const [messages, setMessages] = useApplicationState<string[]>([])
  const flow = workspace.automations.find((item) => item.id === automationId)
  function update(transform: (current: Automation) => Automation) {
    if (!flow) return
    setMessages([])
    setWorkspace((current) => ({
      ...current,
      automations: current.automations.map((item) =>
        item.id === flow.id ? transform(item) : item,
      ),
    }))
  }
  function drafts() {
    if (!flow) return
    const errors = validateGraph(flow, workspace)
    if (errors.length) {
      setMessages(errors)
      return
    }
    const tasks = flow.nodes
      .filter((node) => node.data.kind === 'task')
      .map((node) =>
        createTask({
          title: node.data.label,
          objective: node.data.objective,
          agentId: node.data.agentId,
          repositoryId: node.data.repositoryId,
          origin: flow.id,
          execution: node.data.execution,
        }),
      )
    setWorkspace((current) => ({
      ...current,
      tasks: [...tasks, ...current.tasks],
    }))
    setMessages([
      `Created ${tasks.length} task draft${tasks.length === 1 ? '' : 's'}. No work has executed; graph order and review gates apply when a runtime is connected.`,
    ])
  }
  return {
    workspace,
    flow,
    selectedNode,
    selectNode,
    messages,
    setMessages,
    update,
    drafts,
  }
}
