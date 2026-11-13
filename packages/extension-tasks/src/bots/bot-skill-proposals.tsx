import { useState } from 'react'
import { botResultSchema, type Task } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
export function BotSkillProposals({
  task,
  onSaved,
}: {
  task: Task
  onSaved?: (result: typeof botResultSchema.Type) => void
}) {
  const { request, connected } = useWorkspace()
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ack, setAck] = useState<{ before: string; result: typeof botResultSchema.Type }>()
  const bot = ack && ack.before === task.bot?.revision ? ack.result.bot : task.bot
  const decide = async (proposalId: string, accept: boolean) => {
    if (busy || !bot) return
    setBusy(true)
    setError('')
    try {
      const result = await request(
        '/api/bots/skill-proposal/decide',
        { id: task.id, proposalId, expectedRevision: bot.revision, accept },
        botResultSchema,
      )
      setAck({ before: task.bot?.revision ?? '', result })
      onSaved?.(result)
      setSelected('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const proposals = bot?.skillProposals?.filter((p) => p.status === 'pending') ?? []
  if (!proposals.length && !error) return null
  return (
    <section aria-label="Skill proposals" data-studio-human-only="true" className="grid gap-2">
      <h3 className="font-medium">Proposed skills</h3>
      {proposals.map((p) => (
        <div key={p.id} className="grid gap-2 rounded border p-2">
          <p>
            {p.skill.name} · {p.skill.description}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelected(selected === p.id ? '' : p.id)}
          >
            Review skill diff
          </Button>
          {selected === p.id && (
            <>
              <p className="text-xs">
                From a completed worker or conversation turn. Applies only to this Bot’s future
                turns.
              </p>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{p.patch}</pre>
              <p className="text-xs">
                Description: {p.before?.description ?? '(new skill)'} → {p.skill.description}
              </p>
              <Button
                size="sm"
                disabled={!connected || busy}
                onClick={() => void decide(p.id, true)}
              >
                Apply skill
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!connected || busy}
                onClick={() => void decide(p.id, false)}
              >
                Reject proposal
              </Button>
            </>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
