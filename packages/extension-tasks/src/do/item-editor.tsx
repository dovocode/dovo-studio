import { useEffect, useState } from 'react'
import {
  DO_LIMITS,
  doDiscoverReplySchema,
  type DoDiscoverReply,
  type DoPlanItem,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button, Input } from '@dovo/studio-ui'

const control = 'w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm'
export function ItemEditor({
  item,
  items,
  computers,
  profile,
  disabled,
  onChange,
  onRemove,
}: {
  item: DoPlanItem
  items: readonly DoPlanItem[]
  computers: NonNullable<DoDiscoverReply['computers']>
  profile: RuntimeProfile
  disabled: boolean
  onChange: (item: DoPlanItem) => void
  onRemove: () => void
}) {
  const { readRuntime } = useWorkspace()
  const [catalog, setCatalog] = useState<DoDiscoverReply | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const { runtimeId, repositoryId } = item.target
  useEffect(() => {
    let current = true
    setCatalog(null)
    setError('')
    void readRuntime(
      profile,
      '/api/do/discover',
      {
        runtimeId,
        ...(repositoryId ? { repositoryId } : {}),
      },
      doDiscoverReplySchema,
    )
      .then((reply) => {
        if (current) setCatalog(reply)
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      current = false
    }
  }, [profile, runtimeId, repositoryId, readRuntime, reload])
  const runtimeOptions = computers.some((computer) => computer.id === runtimeId)
    ? computers
    : [
        ...computers,
        {
          id: runtimeId,
          name: runtimeId === 'local' ? 'This computer' : `${runtimeId} (unavailable)`,
          local: runtimeId === 'local',
        },
      ]
  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5"
    >
      <legend className="px-1 text-sm font-medium">{item.id}</legend>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-sm">
          Title
          <Input
            value={item.title}
            maxLength={DO_LIMITS.title}
            onChange={(event) => onChange({ ...item, title: event.target.value })}
          />
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove ${item.id}`}
        >
          Remove item
        </Button>
      </div>
      <label className="block text-sm">
        Instructions
        <textarea
          className={`${control} mt-1 min-h-28 resize-y`}
          value={item.instructions}
          maxLength={DO_LIMITS.instructions}
          onChange={(event) => onChange({ ...item, instructions: event.target.value })}
        />
      </label>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm">
          Computer
          <select
            className={control}
            value={runtimeId}
            onChange={(event) =>
              onChange({
                ...item,
                target: {
                  runtimeId: event.target.value,
                  repositoryId: '',
                  execution: item.target.execution,
                },
              })
            }
          >
            {runtimeOptions.map((computer) => (
              <option key={computer.id} value={computer.id}>
                {computer.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm">
          Project
          <select
            className={control}
            value={repositoryId}
            disabled={!catalog}
            onChange={(event) =>
              onChange({
                ...item,
                target: { ...item.target, repositoryId: event.target.value, agentId: undefined },
              })
            }
          >
            <option value="">{catalog ? 'Select a project' : 'Loading projects…'}</option>
            {repositoryId && !catalog?.projects.some((project) => project.id === repositoryId) && (
              <option value={repositoryId}>{repositoryId} (unavailable)</option>
            )}
            {catalog?.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm">
          Agent
          <select
            className={control}
            value={item.target.agentId ?? ''}
            disabled={!catalog || !repositoryId}
            onChange={(event) =>
              onChange({
                ...item,
                target: { ...item.target, agentId: event.target.value || undefined },
              })
            }
          >
            <option value="">Project default</option>
            {item.target.agentId &&
              !catalog?.agents.some((agent) => agent.id === item.target.agentId) && (
                <option value={item.target.agentId}>{item.target.agentId} (unavailable)</option>
              )}
            {catalog?.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} · {agent.provider}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm">
          Checkout
          <select
            className={control}
            value={item.target.execution ?? ''}
            onChange={(event) => {
              const value = event.target.value
              onChange({
                ...item,
                target: {
                  ...item.target,
                  execution: value === 'main' || value === 'worktree' ? value : undefined,
                },
              })
            }}
          >
            <option value="">Project default</option>
            <option value="worktree">New worktree</option>
            <option value="main">Project checkout (shared)</option>
          </select>
        </label>
      </div>
      {error && (
        <div role="alert" className="text-sm text-destructive">
          Target discovery failed: {error}{' '}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setReload((value) => value + 1)}
          >
            Retry discovery
          </Button>
        </div>
      )}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Wait for completed items</legend>
        {items.length === 1 && (
          <p className="text-xs text-muted-foreground">Add another item to set dependencies.</p>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {items
            .filter((other) => other.id !== item.id)
            .map((other) => (
              <label key={other.id} className="flex min-w-0 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={item.dependsOn.includes(other.id)}
                  onChange={(event) =>
                    onChange({
                      ...item,
                      dependsOn: event.target.checked
                        ? [...item.dependsOn, other.id]
                        : item.dependsOn.filter((id) => id !== other.id),
                    })
                  }
                />
                <span className="break-words">{other.title || other.id}</span>
              </label>
            ))}
        </div>
      </fieldset>
    </fieldset>
  )
}
