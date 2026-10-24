import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import * as Network from 'expo-network'
import * as Crypto from 'expo-crypto'
import { Effect } from 'effect'
import { startPolling } from '@dovo/client-runtime'
import type { useAccount } from '@dovo/studio-core'
import type { Runtime } from './context'
import type { AccountRecoveryState } from './account-context'
import type { MobilePreferences } from '../preferences/app-preferences'
import {
  accountConnectionKey,
  accountRecoveryTarget,
  renewedAccountConnection,
} from './account-recovery'

/** Saved account computers recover without opening the account's management panel. */
export function useAccountRecovery(
  account: ReturnType<typeof useAccount>,
  runtime: Runtime,
  ready: boolean,
  refresh: MobilePreferences['computerRefresh'] = 'normal',
) {
  const latest = useRef({ account, runtime })
  latest.current = { account, runtime }
  const [states, setStates] = useState<Record<string, AccountRecoveryState>>({})
  const session = account.client.sessionId()
  const enabled = ready && account.loaded && runtime.registryLoaded && !runtime.recovering
  const wake = useRef<(() => void) | null>(null)
  const automaticWake = useRef<(() => void) | null>(null)
  const stopping = useRef(Promise.resolve())
  const connections = runtime.overviews
    .map((entry) =>
      [
        entry.profile.id,
        accountConnectionKey(entry.profile.connection),
        entry.connected,
        !!entry.error,
      ].join(':'),
    )
    .join(',')

  useEffect(() => {
    setStates({})
    if (!enabled || !session) return
    const client = account.client
    const attempts = new Map<string, { after: number; failures: number; error: string }>()
    let requested = false
    let worker: ReturnType<typeof startPolling> | undefined
    let mounted = true
    let starting = false
    const current = () => latest.current.account.client === client && client.sessionId() === session
    const start = () => {
      if (worker || starting || !current() || !mounted) return
      starting = true
      void stopping.current.then(() => {
        starting = false
        if (worker || !current() || !mounted || AppState.currentState !== 'active') return
        worker = startPolling(
          Effect.tryPromise({
            try: async (signal) => {
              if (!current() || latest.current.account.busy) return
              const explicit = requested
              requested = false
              if (refresh === 'manual' && !explicit) return
              if (
                refresh === 'reduced' &&
                !explicit &&
                (await Network.getNetworkStateAsync()).type === Network.NetworkStateType.CELLULAR
              )
                return
              const directory = await client.refreshDirectory(signal)
              signal.throwIfAborted()
              if (!current()) return
              await latest.current.runtime.syncAccountSession(session)
              const eligible = new Set<string>()
              for (const entry of latest.current.runtime.overviews) {
                signal.throwIfAborted()
                if (!current()) return
                const server = accountRecoveryTarget(entry, directory, session)
                if (!server) continue
                eligible.add(entry.profile.id)
                const key = entry.profile.id + accountConnectionKey(entry.profile.connection)
                const previous = attempts.get(key)
                if (previous && Date.now() < previous.after) {
                  continue
                }
                const attempt = {
                  after: Date.now() + 30_000,
                  failures: previous?.failures ?? 0,
                  error: '',
                }
                attempts.set(key, attempt)
                setStates((previous) => ({ ...previous, [entry.profile.id]: { pending: true } }))
                try {
                  const incoming = renewedAccountConnection(
                    entry.profile.connection,
                    await client.connectInternet(server, Crypto.getRandomBytes(32), signal),
                  )
                  signal.throwIfAborted()
                  if (!current()) return
                  await latest.current.runtime.recoverAccountConnection(
                    entry.profile,
                    incoming,
                    signal,
                  )
                  attempts.delete(key)
                  if (current())
                    setStates((previous) => ({
                      ...previous,
                      [entry.profile.id]: { pending: false },
                    }))
                } catch (cause) {
                  if (signal.aborted && attempts.get(key) === attempt) attempts.delete(key)
                  signal.throwIfAborted()
                  const failure =
                    cause instanceof Error ? cause.message : 'Could not renew computer access'
                  attempt.failures++
                  attempt.error = failure
                  if (current())
                    setStates((previous) => ({
                      ...previous,
                      [entry.profile.id]: { pending: false, error: failure },
                    }))
                  attempt.after =
                    Date.now() + Math.min(30_000 * 2 ** Math.min(attempt.failures - 1, 4), 300_000)
                }
              }
              if (current())
                setStates((previous) =>
                  Object.fromEntries(Object.entries(previous).filter(([id]) => eligible.has(id))),
                )
            },
            catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
          }),
          {
            interval: refresh === 'reduced' ? 120_000 : 15_000,
            backoff: 60_000,
            onError: (cause) => {
              if (current())
                setStates(
                  Object.fromEntries(
                    latest.current.runtime.overviews
                      .filter(
                        (entry) =>
                          !entry.connected &&
                          (entry.profile.connection.accountSession ||
                            entry.profile.connection.internet),
                      )
                      .map((entry) => [entry.profile.id, { pending: false, error: cause.message }]),
                  ),
                )
            },
          },
        )
        wake.current = () => {
          requested = true
          attempts.clear()
          worker?.refresh()
        }
        automaticWake.current = worker.refresh
      })
    }
    const stop = () => {
      wake.current = null
      automaticWake.current = null
      if (worker) stopping.current = worker.stop()
      worker = undefined
      setStates((previous) =>
        Object.fromEntries(
          Object.entries(previous).map(([id, state]) => [
            id,
            state.pending ? { pending: false } : state,
          ]),
        ),
      )
    }
    if (AppState.currentState === 'active') start()
    const activity = AppState.addEventListener('change', (state) => {
      if (state === 'active') start()
      else stop()
    })
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected) worker?.refresh()
    })
    return () => {
      mounted = false
      activity.remove()
      network.remove()
      stop()
    }
  }, [account.client, enabled, session, refresh])

  useEffect(() => {
    // Connection changes wake normal recovery, but do not override the energy preference.
    if (refresh === 'normal') automaticWake.current?.()
  }, [connections, refresh])
  useEffect(() => {
    if (refresh === 'normal' && account.loaded && !account.busy) automaticWake.current?.()
  }, [account.loaded, account.busy, refresh])
  return { states, retry: () => wake.current?.() }
}
