import { useRef, useState } from 'react'
import {
  botAvatarPreviewSchema,
  botResultSchema,
  randomUUID,
  harnessAvailabilityCandidates,
  providerDisplayName,
  type BotAvatarGenerate,
  type BotResult,
  type Task,
} from '@dovo/protocol'
import { responses, useWorkspace } from '@dovo/studio-core'
import { BotAvatar, Button, Input } from '@dovo/studio-ui'
import { botScope } from './bot-scope'

type Draft = {
  prompt: string
  harnessId?: string
  preview?: string
  request?: BotAvatarGenerate
}
const drafts = new Map<string, Draft>()

export function BotAvatarEditor({
  task,
  onSaved,
}: {
  task: Task
  onSaved: (result: BotResult) => void
}) {
  const { request, snapshot, connected, activeRuntimeId, connection } = useWorkspace()
  const scope = `${botScope(snapshot?.runtimeId ?? activeRuntimeId, connection)}:${task.id}`
  const [draft, setDraft] = useState<Draft>(
    () =>
      drafts.get(scope) ?? {
        prompt: 'A friendly illustrated assistant, clean background, clear at small sizes.',
      },
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const harnesses = harnessAvailabilityCandidates(
    snapshot?.workspace.agents ?? [],
    snapshot?.acpInstallations ?? [],
  ).map(({ id, agent }) => ({
    id,
    name: id.startsWith('harness:') ? providerDisplayName(agent.provider) : agent.name,
  }))
  if (draft.harnessId && !harnesses.some((choice) => choice.id === draft.harnessId))
    harnesses.push({ id: draft.harnessId, name: 'Unavailable harness' })
  const disabled = !connected || !snapshot?.botAvatarsSupported || busy
  const retain = (next: Draft) => {
    drafts.set(scope, next)
    setDraft(next)
  }
  const act = async (run: () => Promise<void>) => {
    if (disabled || lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await run()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const save = (avatar: string | null) =>
    act(async () => {
      const result = await request(
        '/api/bots/update',
        { id: task.id, expectedRevision: task.bot?.revision, avatar },
        botResultSchema,
      )
      onSaved(result)
      retain({ ...draft, preview: undefined, request: undefined })
    })
  return (
    <section aria-label="Bot avatar" className="grid gap-3">
      <h2 className="font-semibold">Avatar</h2>
      <BotAvatar avatar={draft.preview ?? task.bot?.avatar} name={task.title} className="size-20" />
      {!snapshot?.botAvatarsSupported && (
        <p className="text-xs text-muted-foreground">Update this runtime to set a Bot avatar.</p>
      )}
      <label className="grid gap-1 text-xs">
        Choose an image
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            void act(async () => {
              if (file.size > 5 * 1024 * 1024) throw Error('Choose an image smaller than 5 MB.')
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () =>
                  typeof reader.result === 'string'
                    ? resolve(reader.result.slice(reader.result.indexOf(',') + 1))
                    : reject(Error('Could not read this image.'))
                reader.onerror = () => reject(Error('Could not read this image.'))
                reader.readAsDataURL(file)
              })
              const result = await request(
                '/api/bots/avatar/upload',
                { id: task.id, data },
                botAvatarPreviewSchema,
              )
              retain({ ...draft, preview: result.avatar })
            })
          }}
        />
      </label>
      <label className="grid gap-1 text-xs">
        Avatar generation harness
        <select
          aria-label="Avatar generation harness"
          className="rounded-md border border-input bg-background p-2 text-foreground"
          value={draft.harnessId ?? ''}
          disabled={disabled || !!draft.request || !snapshot?.botAvatarHarnessSelectionSupported}
          onChange={(event) => retain({ ...draft, harnessId: event.target.value || undefined })}
        >
          <option value="">Use Bot harness</option>
          {harnesses.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        Describe an avatar
        <Input
          aria-label="Avatar description"
          value={draft.prompt}
          maxLength={2000}
          disabled={disabled || !!draft.request}
          onChange={(event) => retain({ ...draft, prompt: event.target.value })}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        A temporary chat uses the selected harness, this Bot’s access limits and installed image
        tools. It returns a preview without posting to the conversation. Image generation can incur
        provider charges.
      </p>
      <div className="flex flex-wrap gap-2" data-studio-human-only>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !draft.prompt.trim()}
          onClick={() =>
            void act(async () => {
              const input = draft.request ?? {
                id: task.id,
                requestId: randomUUID(),
                prompt: draft.prompt.trim(),
                ...(draft.harnessId ? { harnessId: draft.harnessId } : {}),
              }
              retain({ ...draft, request: input })
              const result = await request(
                '/api/bots/avatar/generate',
                input,
                botAvatarPreviewSchema,
              )
              if (drafts.get(scope)?.request?.requestId === input.requestId)
                retain({ ...draft, preview: result.avatar, request: undefined })
            })
          }
        >
          {busy ? 'Working…' : draft.request ? 'Retry generation' : 'Generate avatar'}
        </Button>
        {draft.request && (
          <Button
            size="sm"
            variant="ghost"
            disabled={!connected}
            onClick={() => {
              if (!draft.request) return
              void request('/api/bots/avatar/cancel', draft.request, responses.ok)
                .then(() => {
                  if (drafts.get(scope)?.request?.requestId === draft.request?.requestId)
                    retain({ ...drafts.get(scope)!, request: undefined })
                })
                .catch((error: unknown) => setError(String(error)))
            }}
          >
            Cancel generation
          </Button>
        )}
        {draft.preview && (
          <>
            <Button size="sm" disabled={disabled} onClick={() => void save(draft.preview!)}>
              Use avatar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => retain({ ...draft, preview: undefined })}
            >
              Discard preview
            </Button>
          </>
        )}
        {task.bot?.avatar && (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void save(null)}>
            Remove avatar
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
