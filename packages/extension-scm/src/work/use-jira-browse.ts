import { jiraReader } from '@dovo/studio-core/jira-reads'
import { useEffect, useRef, useState } from 'react'
import { Effect, type Schema } from 'effect'
import { clientTaskScope } from '@dovo/studio-core'
import {
  jiraBoardsSchema,
  jiraSprintsSchema,
  RuntimeRequestError,
  type RuntimeReadCache,
} from '@dovo/protocol'
import { guardedSourceRead } from '../connections/source-readers'
import type { WorkSource } from './work-sources'

function useBrowseResource<T extends { stale?: boolean; refreshError?: string }, I>(
  key: string,
  cache: RuntimeReadCache | undefined,
  schema: Schema.Codec<T, I>,
  enabled: boolean,
  connected: boolean,
  load: (refresh: boolean) => Effect.Effect<T, Error>,
) {
  const [state, setState] = useState<{ key: string; value?: T; busy: boolean; error: string }>({
    key,
    busy: false,
    error: '',
  })
  const [tick, setTick] = useState(0)
  const force = useRef(false)
  useEffect(() => {
    if (!enabled) return
    const tasks = clientTaskScope()
    let stopped = false
    const refresh = force.current
    force.current = false
    setState({ key, busy: connected, error: '' })
    let liveFinished = false
    let liveLoaded = false
    let forbidden = false
    let savedValue: T | undefined
    void tasks.run(
      Effect.gen(function* () {
        const saved = yield* (
          cache
            ?.readEffect(key, schema)
            .pipe(
              Effect.catch(() =>
                Effect.logWarning('Could not read saved Jira browse data').pipe(
                  Effect.as(undefined),
                ),
              ),
            ) ?? Effect.succeed(undefined)
        )
        savedValue = saved?.value
        if (!stopped && !liveLoaded && !forbidden && saved)
          setState((current) => ({
            key,
            value: { ...saved.value, stale: true },
            busy: connected && !liveFinished,
            error: current.key === key ? current.error : '',
          }))
      }),
    )
    void tasks.run(
      Effect.gen(function* () {
        if (!connected) return
        const value = yield* load(refresh)
        if (stopped) return
        liveFinished = true
        liveLoaded = true
        setState({ key, value, busy: false, error: value.refreshError ?? '' })
        if (JSON.stringify(savedValue) !== JSON.stringify(value))
          yield* cache?.writeEffect(key, value) ?? Effect.void
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            if (stopped) return
            liveFinished = true
            forbidden =
              error instanceof RuntimeRequestError && [401, 403, 409].includes(error.status ?? 0)
            setState((current) => ({
              key,
              value: forbidden ? undefined : current.value,
              busy: false,
              error: error instanceof Error ? error.message : String(error),
            }))
          }),
        ),
      ),
    )
    return () => {
      stopped = true
      void tasks.stop()
    }
    // Scope keys include every request parameter; closures are captured for that scope.
  }, [key, cache, enabled, connected, tick])
  return {
    ...(state.key === key ? state : { value: undefined, busy: enabled && connected, error: '' }),
    retry: () => {
      force.current = true
      setTick((value) => value + 1)
    },
  }
}

export function useJiraBrowse(
  source: WorkSource | undefined,
  board: string | undefined,
  closed: boolean,
  enabled: boolean,
) {
  const key = JSON.stringify(['jira-browse', source?.scope, source?.jira])
  const request = <T, I>(operation: string, schema: Schema.Codec<T, I>, refresh: boolean) =>
    Effect.gen(function* () {
      if (!source?.jira) return yield* Effect.fail(new Error('Choose a Jira source.'))
      return yield* guardedSourceRead(source, (guard) =>
        jiraReader(source.readCache, source.scope, source.requestEffect)(
          `/api/scm/work/jira/${operation}`,
          { ...source.input, ...guard, id: board, state: closed ? 'closed' : 'open', refresh },
          schema,
        ),
      )
    })
  const boards = useBrowseResource(
    key + ':boards',
    source?.readCache,
    jiraBoardsSchema,
    enabled && !!source?.jira,
    !!source?.connected,
    (refresh) => request('boards', jiraBoardsSchema, refresh),
  )
  const sprints = useBrowseResource(
    JSON.stringify([key, 'sprints', board, closed]),
    source?.readCache,
    jiraSprintsSchema,
    enabled && !!source?.jira && !!board,
    !!source?.connected,
    (refresh) => request('sprints', jiraSprintsSchema, refresh),
  )
  return { boards, sprints }
}
