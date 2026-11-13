import { useRef, useState } from 'react'
import { ArrowRightLeft, ChevronRight, MonitorUp } from 'lucide-react'
import {
  continueHarnessSchema,
  decode,
  randomUUID,
  resolveScopedAgents,
  type Repository,
} from '@dovo/protocol'
import {
  defaultTaskHarness,
  providers,
  resolveTaskAgent,
  responses,
  supportsAccess,
  taskHarnessSchema,
  useWorkspace,
  type Task,
  type TaskHarness,
} from '@dovo/studio-core'
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  permissionPolicyUIIssue,
} from '@dovo/studio-ui'
import { HarnessFields } from '../harness-fields'

/** Shared wording, so both choices describe the same handoff rules. */
const keptHere = 'Provider sessions and credentials stay on this computer.'

/** The runtime rejects these moves; say why before the user configures a transfer. */
function machineMoveBlocker(task: Task, repository: Repository | undefined) {
  if (task.bot) return 'Bots stay on their home computer to keep their memory and identity.'
  if (!repository || repository.kind === 'scratch')
    return 'Threads without a project folder stay on this computer.'
  const links = [
    task.pullRequest && 'pull request',
    task.workItem && 'work item',
    (task.linkedCheckouts?.length || task.pendingLinkedCheckouts?.length) && 'linked projects',
  ].filter((link): link is string => !!link)
  if (links.length)
    return `Unlink the ${links.join(', ').replace(/, ([^,]*)$/, ' and $1')} to move this thread.`
  return undefined
}

/**
 * Continue a started thread with another harness, or on another computer.
 * The harness step ignores the provider lock on purpose: the runtime starts a fresh provider
 * session from the saved conversation. Ordinary harness editors keep the lock.
 */
export function ContinueElsewhereDialog({
  task,
  onMachine,
  repository,
  onDone,
  onClose,
}: {
  task: Task
  /** Opens the project transfer flow in continuation mode. */
  onMachine: () => void
  repository: Repository | undefined
  onDone?: () => void
  onClose: () => void
}) {
  const { workspace, snapshot, request, connected } = useWorkspace()
  const [step, setStep] = useState<'choose' | 'harness'>('choose')
  const machineUnavailable = machineMoveBlocker(task, repository)
  const agents = resolveScopedAgents(
    snapshot?.defaults,
    workspace.repositories.find((repo) => repo.id === task.repositoryId),
    workspace.agents,
  )
  const [value, setValue] = useState<TaskHarness>(() => {
    const agent = resolveTaskAgent(task, agents)
    return agent ? decode(taskHarnessSchema, agent) : defaultTaskHarness('codex')
  })
  const running = task.status === 'running'
  const [stop, setStop] = useState(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  // An uncertain reply is retried with the identical payload, even if the turn stopped since.
  // Only a changed choice starts a new request.
  const attempt = useRef<{ key: string; payload: typeof continueHarnessSchema.Type } | null>(null)
  const queued = !!task.queue?.length
  const policyIssue = permissionPolicyUIIssue(value, snapshot?.permissionPolicySupported === true)
  const blocked =
    !connected ||
    busy ||
    queued ||
    (running && !stop) ||
    !!policyIssue ||
    !supportsAccess(value.provider, value.permission)
  const name = providers[value.provider]?.short ?? value.provider
  const submit = async () => {
    if (blocked) return
    const key = JSON.stringify([value, stop])
    if (attempt.current?.key !== key)
      attempt.current = {
        key,
        payload: { id: task.id, requestId: randomUUID(), harness: value, stop: running && stop },
      }
    const { payload } = attempt.current
    setBusy(true)
    setError('')
    try {
      await request('/api/tasks/continue-harness', payload, responses.ok)
      onDone?.()
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'choose' ? 'Continue elsewhere' : 'Continue with another harness'}
          </DialogTitle>
          <DialogDescription>
            {step === 'choose'
              ? `Continue “${task.title}” with the full saved conversation, checklist and files.`
              : `Your next message starts a new ${name} session from the saved conversation, checklist and attachments. Earlier turns keep their original harness. ${keptHere}`}
          </DialogDescription>
        </DialogHeader>
        {step === 'choose' ? (
          <div className="grid gap-2">
            <button
              type="button"
              className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/60 disabled:pointer-events-none disabled:opacity-50"
              disabled={!connected}
              onClick={() => {
                setError('')
                setStep('harness')
              }}
            >
              <ArrowRightLeft className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Another harness on this computer</span>
                <span className="block text-xs text-muted-foreground">
                  Choose any harness and model. The thread stays here.
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
            <button
              type="button"
              className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/60 disabled:pointer-events-none disabled:opacity-50"
              disabled={!connected || !!machineUnavailable}
              onClick={onMachine}
            >
              <MonitorUp className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Another computer</span>
                <span className="block text-xs text-muted-foreground">
                  {machineUnavailable ??
                    'Move the thread and its checkout to a paired computer. This copy stays read-only for recovery.'}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
            {!connected && (
              <p className="text-xs text-muted-foreground">Connect to this computer to continue.</p>
            )}
          </div>
        ) : (
          <fieldset className="grid gap-3" disabled={!connected || busy}>
            <HarnessFields value={value} onChange={setValue} />
            {running && (
              <label className="flex items-start gap-3 text-sm">
                <Checkbox checked={stop} onCheckedChange={(checked) => setStop(checked === true)} />
                <span>
                  Stop the current turn first
                  <span className="mt-1 block text-xs text-muted-foreground">
                    The agent is working. Its partial reply stays in the conversation.
                  </span>
                </span>
              </label>
            )}
            {queued && (
              <p role="alert" className="text-xs text-destructive">
                Send or remove the queued messages before you change the harness.
              </p>
            )}
            {policyIssue && (
              <p role="alert" className="text-xs text-destructive">
                {policyIssue}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setStep('choose')}
              >
                Back
              </Button>
              <Button disabled={blocked} onClick={() => void submit()}>
                {busy ? 'Switching…' : `Continue with ${name}`}
              </Button>
            </DialogFooter>
          </fieldset>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
