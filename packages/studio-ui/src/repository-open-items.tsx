import { useEffect } from 'react'
import { ChevronRight, FolderOpen } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  jetbrainsOpenTargets,
  repositoryOpenTargets,
  type RepositoryOpenTarget,
} from '@dovo/protocol'
import { responses, useWorkspace } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'

/** Mounted when a menu opens: never advertise applications before the runtime detects them. */
export function RepositoryOpenItems({
  disabled = false,
  itemClass,
  onSelect,
}: {
  disabled?: boolean
  itemClass: string
  onSelect: (target: RepositoryOpenTarget, name: string) => void
}) {
  const { request, connected } = useWorkspace()
  const [revision, setRevision] = useApplicationState(0)
  const [state, setState] = useApplicationState<{
    targets: RepositoryOpenTarget[] | null
    error: string
  }>({ targets: null, error: '' })
  useEffect(() => {
    if (!connected) return
    let cancelled = false
    setState({ targets: null, error: '' })
    void request('/api/scm/open-targets', {}, responses.repositoryOpenTargets).then(
      ({ targets }) => {
        if (!cancelled) setState({ targets, error: '' })
      },
      (error: unknown) => {
        if (!cancelled)
          setState({ targets: null, error: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [connected, request, revision, setState])
  if (!connected)
    return (
      <p className="px-2 py-2 text-xs text-muted-foreground">
        Connect to the runtime to open applications.
      </p>
    )
  if (state.error)
    return (
      <>
        <p role="status" className="max-w-64 px-2 py-2 text-xs text-muted-foreground">
          Could not detect applications: {state.error}
        </p>
        <DropdownMenu.Item
          className={itemClass}
          onSelect={(event) => {
            event.preventDefault()
            setRevision((value) => value + 1)
          }}
        >
          Retry detection
        </DropdownMenu.Item>
      </>
    )
  if (!state.targets)
    return (
      <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
        Checking installed applications…
      </p>
    )
  const folder = state.targets.includes('explorer')
    ? 'explorer'
    : state.targets.includes('file-manager')
      ? 'file-manager'
      : 'finder'
  const choices = repositoryOpenTargets(folder).filter(([target]) =>
    state.targets?.includes(target),
  )
  const jetbrains = choices.filter(([target]) => jetbrainsOpenTargets.some(([id]) => id === target))
  const other = choices.filter((choice) => !jetbrains.includes(choice))
  const item = ([target, name]: (typeof choices)[number]) => (
    <DropdownMenu.Item
      key={target}
      className={itemClass}
      disabled={disabled}
      onSelect={() => onSelect(target, name)}
    >
      <FolderOpen className="size-3.5 shrink-0" /> Open in {name}
    </DropdownMenu.Item>
  )
  if (!choices.length)
    return (
      <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
        No supported applications found on the runtime computer.
      </p>
    )
  return (
    <>
      {other.map(item)}
      {!!jetbrains.length && (
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger className={itemClass} disabled={disabled}>
            <FolderOpen className="size-3.5 shrink-0" /> JetBrains{' '}
            <ChevronRight className="ml-auto size-3.5" />
          </DropdownMenu.SubTrigger>
          <DropdownMenu.Portal>
            <DropdownMenu.SubContent
              sideOffset={4}
              collisionPadding={8}
              className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-48 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
              {jetbrains.map(item)}
            </DropdownMenu.SubContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Sub>
      )}
    </>
  )
}
