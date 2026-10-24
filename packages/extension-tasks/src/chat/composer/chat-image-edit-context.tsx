import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react'
import { Pencil } from 'lucide-react'
import { useWorkspace } from '@dovo/studio-core'
import type { ChatImageSource } from '@dovo/protocol'
import { Button } from '@dovo/studio-ui'

export type ChatImageUpload = (file: File) => Promise<void>
export const ChatImageEditContext = createContext<{
  edit: (source: ChatImageSource, label: string) => Promise<void>
  busy: boolean
  disabled: boolean
  available: boolean
  register: (upload: ChatImageUpload | null) => void
} | null>(null)

/** Use the composer's current upload destination, including a queued message being edited. */
export function useChatImageUploader(upload: ChatImageUpload, enabled: boolean) {
  const context = useContext(ChatImageEditContext)
  const register = context?.register
  const current = useRef(upload)
  useLayoutEffect(() => {
    current.current = upload
  })
  useEffect(() => {
    register?.(enabled ? (file) => current.current(file) : null)
    return () => register?.(null)
  }, [register, enabled])
  return context?.busy ?? false
}

export function EditChatImage({
  source,
  label,
  onEdit,
  compact = false,
}: {
  source: ChatImageSource
  label: string
  onEdit?: () => void
  compact?: boolean
}) {
  const context = useContext(ChatImageEditContext)
  const { connected } = useWorkspace()
  if (!context) return null
  return (
    <Button
      type="button"
      size={compact ? 'icon' : 'sm'}
      variant="ghost"
      className={
        compact
          ? 'size-7 shrink-0 text-muted-foreground [@media(pointer:coarse)]:size-11'
          : undefined
      }
      title={`Edit and attach ${label}`}
      disabled={!connected || context.disabled || context.busy || !context.available}
      aria-label={`Edit and attach ${label}`}
      onClick={() => {
        onEdit?.()
        void context.edit(source, label)
      }}
    >
      <Pencil className="size-3.5" />
      {!compact && 'Edit & attach'}
    </Button>
  )
}
