import { useCallback, useEffect, useRef, useState } from 'react'
import { Effect } from 'effect'
import { runClientEffect, startPolling } from '@dovo/client-runtime'
import { forgeSourceIdentitySchema, RuntimeRequestError, type RuntimeProfile } from '@dovo/protocol'
import { useRuntime, type Runtime } from '../runtime/connection/provider'
import { integrationDraftKey } from '../runtime/state/detail-drafts'
import { mobileReaders } from './verified-reader'

type SourceInput = { repositoryId?: string; jiraSourceId?: string; connectionId?: string }

export function discoverReader(read: Runtime['readEffect'], key: string, input: SourceInput) {
  return read('/api/scm/source/identity', input, forgeSourceIdentitySchema).pipe(
    Effect.flatMap((identity) =>
      Effect.try({
        try: () => mobileReaders.remember(key, identity),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
    ),
    Effect.catch((error) =>
      // Legacy runtimes remain readable, but missing identity never authorizes failover.
      error instanceof RuntimeRequestError &&
      (error.status === 501 || (error.status === 404 && error.message === 'Endpoint not found')) &&
      !mobileReaders.identity(key)
        ? Effect.succeed(undefined)
        : Effect.sync(() => mobileReaders.unavailable(key)).pipe(
            Effect.andThen(Effect.fail(error)),
          ),
    ),
  )
}

export function verifiedSourceRead(
  read: Runtime['readEffect'],
  key: string,
  input: SourceInput,
  expectedReaderIdentity?: string,
): Runtime['readEffect'] {
  return (path, body, schema, method) =>
    Effect.gen(function* () {
      const identity = yield* discoverReader(read, key, input)
      if (expectedReaderIdentity && identity?.readerIdentity !== expectedReaderIdentity)
        return yield* Effect.fail(
          new Error('The original account is unavailable. Connect its runtime to continue.'),
        )
      return yield* read(
        path,
        {
          ...(typeof body === 'object' && body !== null ? body : {}),
          ...(identity
            ? {
                expectedReaderIdentity: identity.readerIdentity,
                expectedDestination: identity.destination,
              }
            : {}),
        },
        schema,
        method,
      )
    })
}

/** Reads are pinned to their original runtime, configured binding and verified account. */
export function useSourceReader(
  repositoryId?: string,
  jiraSourceId?: string,
  connectionId?: string,
) {
  const { readEffect: read, connection, snapshot } = useRuntime()
  const key = integrationDraftKey(connection, snapshot, repositoryId, jiraSourceId, connectionId)
  const [state, setState] = useState(() => ({
    key,
    identity: mobileReaders.identity(key),
    ready: false,
  }))
  const readEffect = useCallback<Runtime['readEffect']>(
    (path, body, schema, method) =>
      verifiedSourceRead(read, key, { repositoryId, jiraSourceId, connectionId })(
        path,
        body,
        schema,
        method,
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() => setState({ key, identity: mobileReaders.identity(key), ready: true })),
        ),
      ),
    [read, key, repositoryId, jiraSourceId, connectionId],
  )
  return {
    readEffect,
    acceptCurrentAccount: () => {
      mobileReaders.acceptAccount(key)
      setState({ key, identity: undefined, ready: false })
    },
    read: useCallback<Runtime['read']>(
      (...args) => runClientEffect(readEffect(...args)),
      [readEffect],
    ),
    identity: state.key === key ? state.identity : mobileReaders.identity(key),
    ready: state.key === key && state.ready,
  }
}

export type ReaderSource = {
  key: string
  profile: RuntimeProfile
  connected: boolean
}

/** Discover alternates before selection; successful ownership survives list remounts. */
export function useSourceIdentities<T extends ReaderSource>(
  sources: readonly T[],
  contentIdentity: (source: T) => string,
  sourceInput: (source: T) => SourceInput,
  enabled: boolean,
) {
  const { readRuntimeEffect } = useRuntime()
  const [, revise] = useState(0)
  const sourceRef = useRef(sources)
  sourceRef.current = sources
  const identity = JSON.stringify(
    sources.map((source) => [contentIdentity(source), source.connected]),
  )
  useEffect(() => {
    let stopped = false
    if (!enabled) return
    const polling = startPolling(
      Effect.forEach(
        sourceRef.current.filter((source) => source.connected),
        (source) =>
          discoverReader(
            (path, body, schema, method) =>
              readRuntimeEffect(source.profile, path, body, schema, method),
            contentIdentity(source),
            sourceInput(source),
          ).pipe(Effect.catch(() => Effect.succeed(undefined))),
        { concurrency: 3, discard: true },
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (!stopped) revise((value) => value + 1)
          }),
        ),
      ),
      {
        interval: 30000,
        onError: () => {},
      },
    )
    return () => {
      stopped = true
      void polling.stop()
    }
  }, [identity, enabled, readRuntimeEffect])
  return sources.map((source) => ({
    ...source,
    readerIdentity: mobileReaders.candidateIdentity(contentIdentity(source)),
  }))
}
