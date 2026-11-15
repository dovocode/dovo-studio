import { useRef, useState, type ReactNode } from 'react'
import { useWorkspace } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { repositorySchema } from '@dovo/protocol'

declare global {
  interface Window {
    dovoTerminalFilePath?: (file: File) => string
  }
}

export function ProjectFolderDrop({
  children,
  onAdded,
}: {
  children: ReactNode
  onAdded: (id: string) => void
}) {
  const store = useWorkspace()
  const uiText = useInterfaceText()
  const current = useRef(store)
  current.current = store
  const lock = useRef(false)
  const [over, setOver] = useState(false)
  const [status, setStatus] = useState('')
  const local = store.runtimes.find((entry) => entry.profile.id === store.localRuntimeId)
  return (
    <div
      className="relative min-w-0"
      onDragOver={(event) => {
        if (event.defaultPrevented || !event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={(event) => {
        if (
          !event.currentTarget.contains(
            event.relatedTarget instanceof Node ? event.relatedTarget : null,
          )
        )
          setOver(false)
      }}
      onDrop={(event) => {
        if (event.defaultPrevented || !event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setOver(false)
        if (lock.current) return
        const resolve = window.dovoTerminalFilePath
        if (!resolve) {
          setStatus('Use Add project to choose a folder in the web app.')
          return
        }
        if (!local?.connected) {
          setStatus('Connect this computer before dropping a project folder.')
          return
        }
        const files = Array.from(event.dataTransfer.items).flatMap((item) => {
          const entry = item.webkitGetAsEntry()
          const file = item.getAsFile()
          return entry?.isDirectory && file ? [file] : []
        })
        if (!files.length) {
          setStatus('Drop folders here. Drop files on a thread to attach them.')
          return
        }
        const profile = local.profile
        const before = store.activeRuntimeId
        lock.current = true
        setStatus('Adding project folders…')
        void (async () => {
          try {
            let last: string | undefined
            for (const file of files) {
              const path = resolve(file)
              if (!path) throw new Error('The dropped folder path is unavailable.')
              last = (
                await store.readRuntime(
                  profile,
                  '/api/scm/repositories/add',
                  { source: 'local', name: file.name, path },
                  repositorySchema,
                  'POST',
                )
              ).id
            }
            await store.refreshRuntime(profile)
            if (
              current.current.activeRuntimeId === before &&
              current.current.localRuntimeId === profile.id
            ) {
              if (before !== profile.id) await store.switchRuntime(profile.id)
              if (
                current.current.localRuntimeId === profile.id &&
                current.current.activeRuntimeId === profile.id &&
                last
              )
                onAdded(last)
            }
            setStatus('Project folders added on this computer.')
          } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Could not add the project folders.')
          } finally {
            lock.current = false
          }
        })()
      }}
    >
      {children}
      {over && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-background/95 p-3 text-xs ring-2 ring-ring"
        >
          {uiText('Drop folders to add projects')}
        </div>
      )}
      {status && (
        <p role="status" className="px-2 text-xs text-muted-foreground">
          {uiText(status)}
        </p>
      )}
    </div>
  )
}
