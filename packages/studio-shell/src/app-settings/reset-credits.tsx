import { useRef, useState } from 'react'
import {
  resetCreditsSchema,
  resetCreditResultSchema,
  type PlanLimit,
  useWorkspace,
} from '@dovo/studio-core'
import type { Schema } from 'effect'
import {
  Button,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@dovo/studio-ui'
export function ResetCredits({ window }: { window: PlanLimit & { sourceId?: string } }) {
  const { runtimes, readRuntime, refreshRuntime } = useWorkspace()
  const sources = runtimes.flatMap((entry) => {
    const limit = entry.snapshot?.workspace.planLimits?.find(
      (limit) => limit.account?.id === window.account?.id && !!limit.sourceTaskId,
    )
    return limit ? [{ profile: entry.profile, taskId: limit.sourceTaskId }] : []
  })
  const [runtimeId, setRuntimeId] = useState(window.sourceId ?? '')
  const source = sources.find((source) => source.profile.id === runtimeId) ?? sources[0]
  const profile = source?.profile
  const [open, setOpen] = useState(false)
  const [credits, setCredits] = useState<Schema.Schema.Type<typeof resetCreditsSchema> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState('')
  const [confirming, setConfirming] = useState(false)
  const attempt = useRef<string | undefined>(undefined)
  const input = { taskId: source?.taskId, accountId: window.account?.id }
  const load = async () => {
    if (!profile) return
    const data = await readRuntime(
      profile,
      '/api/usage/resets/read',
      input,
      resetCreditsSchema,
      'POST',
    )
    if (data.pendingAttemptId) attempt.current = data.pendingAttemptId
    setCredits(data)
    await refreshRuntime(profile)
  }
  const check = async () => {
    setOpen(true)
    setBusy(true)
    setError('')
    setConfirming(false)
    try {
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const consume = async () => {
    if (!profile || busy) return
    setBusy(true)
    setError('')
    attempt.current ??= crypto.randomUUID()
    try {
      const result = await readRuntime(
        profile,
        '/api/usage/resets/consume',
        { ...input, creditId: credits?.credits[0]?.id, idempotencyKey: attempt.current },
        resetCreditResultSchema,
        'POST',
      )
      setOutcome(`Provider result: ${result.outcome}`)
      attempt.current = undefined
      setConfirming(false)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="mt-3 h-7 text-xs"
        disabled={!profile || !window.account || !source?.taskId}
        onClick={() => void check()}
      >
        Reset credits
      </Button>
      <Dialog open={open} onOpenChange={(value) => !busy && setOpen(value)}>
        <DialogContent className="max-w-md">
          <DialogTitle>Subscription reset credits</DialogTitle>
          <DialogDescription>
            {window.account?.label} · Redeeming a reset spends one provider credit. It does not
            reset local usage history.
          </DialogDescription>
          {sources.length > 1 && (
            <ChoicePicker
              aria-label="Server for reset"
              value={profile?.id ?? ''}
              disabled={busy}
              onValueChange={(id) => {
                setRuntimeId(id)
                setCredits(null)
                setError('')
                setConfirming(false)
              }}
            >
              {sources.map((source) => (
                <option key={source.profile.id} value={source.profile.id}>
                  {source.profile.name}
                </option>
              ))}
            </ChoicePicker>
          )}
          {busy && <p className="text-xs text-muted-foreground">Contacting provider…</p>}
          {credits && (
            <div className="space-y-2 text-xs">
              <p>
                {credits.supported ? `${credits.availableCount} resets available` : credits.reason}
              </p>
              {credits.availableCount > 0 && !credits.credits.length && (
                <p className="text-xs text-muted-foreground">Credit expiry details not reported.</p>
              )}
              {credits.credits.map((credit) => (
                <p key={credit.id}>
                  {credit.title} ·{' '}
                  {credit.expiresAt
                    ? `Expires ${new Date(credit.expiresAt).toLocaleString()}`
                    : 'Expiry not reported'}
                </p>
              ))}
              {credits.supported && credits.availableCount > 0 && (
                <Button
                  disabled={busy}
                  onClick={() => (confirming ? void consume() : setConfirming(true))}
                >
                  {confirming ? 'Confirm: use one reset credit' : 'Use reset'}
                </Button>
              )}
              {confirming && (
                <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              )}
            </div>
          )}
          {!!outcome && <p className="text-xs">{outcome}</p>}
          {!!error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <Button variant="outline" disabled={busy} onClick={() => void check()}>
            Refresh credits
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
