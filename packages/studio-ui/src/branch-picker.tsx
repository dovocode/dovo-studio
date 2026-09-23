import { useApplicationState } from '@dovo/studio-core/state'
import { ChoicePicker } from './choice-picker'
import { GitBranch } from 'lucide-react'
import { branchesSchema } from '@dovo/protocol'
import { Schema } from 'effect'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
type Branches = Schema.Schema.Type<typeof branchesSchema>
export function BranchPicker({
  current,
  disabled,
  load,
  change,
}: {
  current?: string
  disabled?: boolean
  load: () => Promise<Branches>
  change: (input: {
    action: 'switch' | 'create'
    name: string
    revision: string
  }) => Promise<Branches>
}) {
  const [open, setOpen] = useApplicationState(false),
    [data, setData] = useApplicationState<Branches | null>(null),
    [selected, setSelected] = useApplicationState(''),
    [name, setName] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const act = async (operation: () => Promise<Branches>) => {
    setBusy(true)
    setError('')
    try {
      setData(await operation())
      setSelected('')
      setName('')
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || busy}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
          if (!open) void act(load)
        }}
      >
        <GitBranch className="size-3.5" />
        {data?.current ?? current ?? 'Branches'}
      </Button>
      {open && (
        <div className="space-y-2 rounded-lg border p-3 text-xs">
          {busy && (
            <p role="status" className="text-muted-foreground">
              Loading branches…
            </p>
          )}
          <div className="flex items-center justify-between">
            <span>Switch branch · {data?.current ?? current}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy || disabled}
              onClick={() => void act(load)}
            >
              Refresh branches
            </Button>
          </div>
          <div className="flex gap-2">
            <ChoicePicker
              aria-label="Target branch"
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2"
              value={selected}
              onValueChange={(selection) => setSelected(selection)}
              disabled={busy || disabled}
            >
              <option value="">Choose a branch</option>
              {data?.branches.map((b) => (
                <option
                  key={b.ref}
                  value={b.ref}
                  disabled={!b.remote && (b.checkedOut || b.name === data.current)}
                >
                  {b.name}
                  {b.remote ? ' · remote' : b.checkedOut ? ' · checked out' : ''}
                </option>
              ))}
            </ChoicePicker>
            <Button
              type="button"
              size="sm"
              disabled={busy || disabled || !selected || !data}
              onClick={() =>
                data &&
                void act(() =>
                  change({
                    action: 'switch',
                    name: selected,
                    revision: data.revision,
                  }),
                )
              }
            >
              Switch
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              aria-label="New branch name"
              placeholder="New branch from current checkout"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={busy || disabled || !name.trim() || !data}
              onClick={() =>
                data &&
                void act(() =>
                  change({
                    action: 'create',
                    name: name.trim(),
                    revision: data.revision,
                  }),
                )
              }
            >
              Create branch
            </Button>
          </div>
          <p className="text-muted-foreground">
            Commit or stash changes first. Switching starts fresh agent sessions and pauses queued
            work in this checkout.
          </p>
          {!!error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
