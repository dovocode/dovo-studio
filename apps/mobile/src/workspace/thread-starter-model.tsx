import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import {
  decode,
  defaultTaskHarness,
  resolveScopedAgents,
  resolveTaskAgent,
  taskHarnessSchema,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { HarnessModelPicker } from '../agents/harness-model-picker'
import { useHarnessAvailability } from '../agents/use-harness-availability'
import { taskHarnessChoices, taskHarnessSelection } from '../tasks/creation/harness-choices'
import { Action } from '../ui/controls/action'
import { Sheet } from '../ui/layout/sheet'

export type StarterModel = Pick<
  Task,
  'agentId' | 'harness' | 'harnessCustomized' | 'agentOverrides' | 'modelSelection'
>
export function ThreadStarterModel({
  task,
  disabled,
  onChange,
}: {
  task: Task
  disabled: boolean
  onChange: (fields: StarterModel) => void
}) {
  const uiText = useInterfaceText()

  const { snapshot } = useRuntime()
  const [open, setOpen] = useState(false)
  const repository = snapshot?.workspace.repositories.find((item) => item.id === task.repositoryId)
  const agents = resolveScopedAgents(
    snapshot?.defaults,
    repository,
    snapshot?.workspace.agents ?? [],
  )
  const agent = resolveTaskAgent(task, agents) ?? {
    ...defaultTaskHarness('codex'),
    id: 'task',
    name: 'Codex',
  }
  const availability = useHarnessAvailability(task.repositoryId, agents)
  return (
    <>
      <Action
        secondary
        label={uiText('Model · {value0}', { value0: agent.model || agent.name })}
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      {open && (
        <Sheet title={uiText('Choose a model')} onClose={() => setOpen(false)}>
          <HarnessModelPicker
            task={task}
            agent={agent}
            agents={agents}
            selection={taskHarnessSelection(task)}
            choices={taskHarnessChoices(
              task,
              agents,
              snapshot?.acpInstallations,
              snapshot?.defaults?.modelPreferences,
              availability.available,
              true,
            )}
            disabled={disabled}
            onChange={(selection, next) => {
              onChange({
                agentId: selection.startsWith('agent:') ? selection.slice(6) : '',
                harness: decode(taskHarnessSchema, next),
                harnessCustomized: true,
                modelSelection: undefined,
                agentOverrides: undefined,
              })
              setOpen(false)
            }}
          />
        </Sheet>
      )}
    </>
  )
}
