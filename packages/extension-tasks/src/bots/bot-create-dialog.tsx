import { useEffect, useRef, useState } from 'react'
import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@dovo/studio-ui'
import { BotCreateForm } from './bot-create'
import type { RuntimeProfile } from '@dovo/protocol'
import { botCreateHosts, botPairing } from './bot-create-host'

export function BotCreateDialog({ onClose }: { onClose: () => void }) {
  const store = useWorkspace()
  const host = useStudioHost()
  const latest = useRef(store)
  latest.current = store
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState<{
    id: string
    profile: RuntimeProfile
    resolve: (opened: boolean) => void
    reject: (error: Error) => void
  } | null>(null)
  const pending = useRef(opening)
  useEffect(() => {
    if (!opening) return
    const paired = botCreateHosts(store).some(
      (item) => item.pairing === botPairing(opening.profile),
    )
    if (!paired) {
      opening.reject(Error('This computer’s pairing changed. Reopen its Bots to continue.'))
      setOpening(null)
    } else if (store.activeRuntimeId === opening.profile.id) {
      // Navigation must see the committed owner, even when switchRuntime resolves first.
      host.navigate({ viewId: 'bots', entityId: opening.id })
      opening.resolve(true)
      setOpening(null)
      onClose()
    }
  }, [opening, store, host, onClose])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      pending.current?.resolve(false)
    }
  }, [])
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="flex max-h-[90dvh] max-w-4xl flex-col overflow-y-auto">
        <DialogTitle>New Bot</DialogTitle>
        <DialogDescription>Choose a computer and give your Bot a role.</DialogDescription>
        <BotCreateForm
          navigating={busy}
          onCancel={onClose}
          onCreated={async (id, profile) => {
            setBusy(true)
            try {
              const pairing = botPairing(profile)
              const paired = () =>
                botCreateHosts(latest.current).some((item) => item.pairing === pairing)
              if (!paired())
                throw Error('This computer’s pairing changed. Reopen its Bots to continue.')
              if (profile.id !== latest.current.activeRuntimeId)
                await latest.current.switchRuntime(profile.id)
              if (!mounted.current) return false
              if (!paired())
                throw Error('The active computer changed. Select Open Bot to continue.')
              return await new Promise<boolean>((resolve, reject) => {
                const request = { id, profile, resolve, reject }
                pending.current = request
                setOpening(request)
              })
            } finally {
              if (mounted.current) setBusy(false)
            }
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
