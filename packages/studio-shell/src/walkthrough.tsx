import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { Button, IconButton } from '@dovo/studio-ui'
export const walkthroughSteps = [
  {
    title: 'Your workspace',
    view: 'tasks',
    text: 'Tasks own the conversation. Choose Chat, Changes or Terminal in the header. Turn on Split with chat to keep the conversation alongside your work.',
  },
  {
    title: 'Queue and steer',
    view: 'tasks',
    text: 'Send follow-ups while an agent works. Reorder, remove or pause queued messages above the composer. Stop pauses the queue; Resume queue continues it. Turn labels and tool activity retain what happened.',
  },
  {
    title: 'Answer agent questions',
    view: 'tasks',
    text: 'When an agent needs a decision, answer its compact form in the conversation. Choose options or enter your own text, then Send answers. You can answer from a paired phone too. Decline skips the question; Stop cancels the turn.',
  },
  {
    title: 'Attach context',
    view: 'tasks',
    text: 'Use the paperclip, drop files or paste an image into your message. Files stay with queued follow-ups and chat history. Open a file chip to preview or download it; paired phones use native file picking and sharing.',
  },
  {
    title: 'Organize your work',
    view: 'tasks',
    text: 'Sort tasks by priority, activity, project or title. Pin current work, snooze tasks for later, and settle finished tasks. Find settled work with the task filter and reopen it when needed. Task settings changes the model and reasoning for this conversation without changing your reusable agent.',
  },
  {
    title: 'Review and edit',
    view: 'tasks',
    text: 'Open Changes and choose a file. Pierre Diffs supports unified or split review and direct editing. Save draft preserves edits; Apply saved draft writes them to the repository with conflict protection.',
  },
  {
    title: 'Code context',
    view: 'tasks',
    text: 'Use the Projects menu in Tasks to add a project or open Project settings. Choose the project checkout or a task worktree, then use Branches to switch or create a branch. Commit or stash changes first. Task settings also offers branch controls.',
  },
  {
    title: 'Issues to tasks',
    view: 'issues',
    text: 'Open Issues to browse your project’s tracker, including Jira when configured. Start task creates a draft with the issue’s context. Review the draft before sending it, and use its issue link to return to the discussion.',
  },
  {
    title: 'Pull requests',
    view: 'pulls',
    text: 'Use Overview, Files, Activity and Checks in Pull requests. Reviews and discussion comments have distinct labels. Start a task from a PR or create a PR from a task’s branch. Checks can take you to pipeline runs for the same commit.',
  },
  {
    title: 'Pipeline runs',
    view: 'pulls',
    text: 'Open a pull request’s Checks tab to inspect pipeline runs for its commit, including jobs, steps and logs. Investigate run creates a task draft with the run context. Back returns to the same PR. Run controls depend on the provider and current status.',
  },
  {
    title: 'Reusable agents',
    view: 'agents',
    text: 'Open Settings → Agents to configure Codex, OpenCode, Claude and ACP separately. Models, instructions and permissions belong to each agent.',
  },
  {
    title: 'Tools and skills',
    view: 'resources',
    text: 'In Settings → MCP & skills, choose a project or agent scope to manage its tools and instructions. Project entries provide task defaults; agent entries with the same name override them. Changes apply on the next turn.',
  },
  {
    title: 'Automations',
    view: 'jobs',
    text: 'Open Automations to follow Runs, edit the Canvas or configure Triggers. Select a step to configure it, run the flow, and approve review gates.',
  },
  {
    title: 'Private access',
    view: 'runtime',
    text: 'Pair with a reachable LAN, Tailscale or NetBird runtime address. Default server pairing codes approve devices automatically for two minutes. Codes generated here require host approval and are single use. Revoke a device’s access here at any time.',
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
