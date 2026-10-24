import { createContext, useContext } from 'react'
import type { ChatImageSource } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { IconButton } from '../../ui/controls/icon-button'

export const ChatImageEditContext = createContext<{
  edit: (source: ChatImageSource, label: string) => Promise<void>
  busy: boolean
  disabled: boolean
} | null>(null)

export function EditChatImage({
  source,
  label,
  onEdit,
  glass = false,
}: {
  source: ChatImageSource
  label: string
  onEdit?: () => void
  glass?: boolean
}) {
  const context = useContext(ChatImageEditContext)
  const { connected } = useRuntime()
  if (!context) return null
  return (
    <IconButton
      icon="edit"
      variant={glass ? 'glass' : 'plain'}
      label={`Edit and attach ${label}`}
      disabled={!connected || context.disabled || context.busy}
      onPress={() => {
        onEdit?.()
        void context.edit(source, label)
      }}
    />
  )
}
