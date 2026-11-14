import { useEffect } from 'react'
import { Schema } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import {
  decode,
  mutableArray,
  mutableStruct,
  pendingRuntimePairingSchema,
  projectTransferPeers,
  studioPeerRegistrationSchema,
  type RuntimeOverview,
  type RuntimeRegistry,
} from '@dovo/protocol'
import type { RuntimeReadEffect } from './provider'

/** Publish durable grants only while the human client is active. No background heartbeat. */
export function useStudioPairedComputers(
  overviews: readonly RuntimeOverview[],
  registry: RuntimeRegistry,
  active: boolean,
  read: RuntimeReadEffect,
) {
  const profiles = registry.profiles.filter(
    (profile) => !registry.pendingPairings?.some((pending) => pending.profile.id === profile.id),
  )
  const registrations = JSON.stringify(
    overviews.flatMap((entry) =>
      entry.connected &&
      entry.snapshot?.studioPeerRegistrationEnabled &&
      !!entry.snapshot.studioTools &&
      (entry.snapshot.studioTools.threads ||
        entry.snapshot.studioTools.automations ||
        entry.snapshot.studioTools.browsers ||
        entry.snapshot.studioTools.diagnostics) &&
      profiles.some((profile) => profile.id === entry.profile.id)
        ? [
            {
              profile: entry.profile,
              peers: projectTransferPeers(profiles, overviews, entry.snapshot.runtimeId),
            },
          ]
        : [],
    ),
  )
  useEffect(() => {
    if (!active) return
    const sources = decode(
      mutableArray(
        mutableStruct({
          profile: pendingRuntimePairingSchema.fields.profile,
          peers: studioPeerRegistrationSchema.fields.peers,
        }),
      ),
      JSON.parse(registrations),
    )
    const controller = new AbortController()
    for (const source of sources)
      void runClientEffect(
        read(
          source.profile,
          '/api/studio/peers',
          { sessionId: 'mobile-studio', peers: source.peers },
          mutableStruct({ ok: Schema.Boolean }),
        ),
        controller.signal,
      ).catch(() => {
        if (!controller.signal.aborted)
          console.warn(
            'Studio paired-computer access could not be refreshed. Reconnect this computer to retry.',
          )
      })
    return () => controller.abort()
  }, [registrations, active, read])
}
