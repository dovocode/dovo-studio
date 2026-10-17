import { useEffect } from 'react'
import { Schema } from 'effect'
import {
  decode,
  randomUUID,
  mutableArray,
  mutableStruct,
  connectionSchema,
  studioPeerRegistrationSchema,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import type { RuntimeConnection, StudioTools } from '@dovo/protocol'

const local = (connection: RuntimeConnection) => {
  const hostname = new URL(connection.address).hostname
  return hostname === 'localhost' || hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(hostname)
}
const enabled = (tools?: StudioTools) =>
  tools && (tools.threads || tools.automations || tools.browsers || tools.diagnostics)

/** Share the authenticated fleet for retrieval. Studio Tools forwarding stays local-only. */
export function StudioPairedComputersBridge() {
  const { connection, connected, snapshot, runtimeRegistry, runtimes } = useWorkspace()
  const targets = new Map<string, RuntimeConnection>()
  for (const runtime of runtimes)
    if (runtime.connected)
      targets.set(runtime.profile.connection.address, runtime.profile.connection)
  if (connection && connected) targets.set(connection.address, connection)
  const registrations = JSON.stringify(
    [...targets.values()].map((target) => ({
      target,
      studio:
        local(target) &&
        !!enabled(
          runtimes.find((runtime) => runtime.profile.connection.address === target.address)
            ?.snapshot?.studioTools ?? snapshot?.studioTools,
        ),
      peers: runtimeRegistry.profiles
        .filter(
          (profile) =>
            profile.connection.address !== target.address &&
            !(target.runtimeId && profile.connection.runtimeId === target.runtimeId) &&
            !runtimeRegistry.pendingPairings?.some((pending) => pending.profile.id === profile.id),
        )
        .map(({ id, name, connection }) => ({ id, name, connection })),
    })),
  )
  useEffect(() => {
    const sources = decode(
      mutableArray(
        mutableStruct({
          target: connectionSchema,
          studio: Schema.Boolean,
          peers: studioPeerRegistrationSchema.fields.peers,
        }),
      ),
      JSON.parse(registrations),
    )
    const controller = new AbortController()
    const sessions = sources.map((source) => ({ ...source, sessionId: randomUUID() }))
    const sendEndpoint = async (source: (typeof sessions)[number], endpoint: string) => {
      try {
        const response = await fetch(source.target.address.replace(/\/$/, '') + endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${source.target.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sessionId: source.sessionId, peers: source.peers }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        })
        // Older runtimes have no pairing bridge; the local tools remain usable.
        if (!response.ok && response.status !== 404 && !controller.signal.aborted)
          console.warn(`Studio paired-computer bridge: HTTP ${response.status}`)
      } catch {
        if (!controller.signal.aborted)
          console.warn(
            'Paired-computer registration disconnected; Studio Tools sessions expire until it reconnects.',
          )
      }
    }
    const send = async (source: (typeof sessions)[number]) => {
      await Promise.all([
        sendEndpoint(source, '/api/retrieval/peers'),
        ...(source.studio ? [sendEndpoint(source, '/api/studio/peers')] : []),
      ])
    }
    for (const source of sessions) void send(source)
    const timer = setInterval(() => {
      for (const source of sessions) void send(source)
    }, 15000)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [registrations])
  return null
}
