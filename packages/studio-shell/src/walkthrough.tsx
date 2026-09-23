import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { Button, IconButton } from '@dovo/studio-ui'
export const walkthroughSteps = [
  {
    title: 'Add your project',
    view: 'tasks',
    text: 'Open Projects in Tasks, choose Add project, then browse for the repository on your computer. Your files stay on that computer.',
  },
  {
    title: 'Choose an agent',
    view: 'agents',
    text: 'Add an agent in Settings → Agents. Choose your provider and model, then check that its command or service is available on your computer.',
  },
  {
    title: 'Send your first task',
    view: 'tasks',
    text: 'Create a task, choose your project and agent, and describe what you want done. Review questions and approvals in the conversation. You can connect your phone later in Settings → Devices & runtime.',
  },
]

export function Walkthrough({
  step,
  onStep,
  onClose,
}: {
  step: number
  onStep: (step: number) => void
  onClose: () => void
}) {
  const item = walkthroughSteps[step]
  return (
    <div className="flex flex-wrap items-center gap-4 border-b bg-secondary/40 px-4 py-3">
      <div className="flex-1">
        <div className="text-xs font-medium">
          {step + 1} / {walkthroughSteps.length} · {item.title}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{item.text}</p>
      </div>
      <Button size="sm" variant="ghost" disabled={step === 0} onClick={() => onStep(step - 1)}>
        <ArrowLeft />
        Back
      </Button>
      <Button
        size="sm"
        onClick={() => (step === walkthroughSteps.length - 1 ? onClose() : onStep(step + 1))}
      >
        {step === walkthroughSteps.length - 1 ? 'Finish' : 'Next'}
        <ArrowRight />
      </Button>
      <IconButton label="Close walkthrough" onClick={onClose}>
        <X />
      </IconButton>
    </div>
  )
}
