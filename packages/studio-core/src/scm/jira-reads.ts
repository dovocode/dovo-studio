import { Effect, Schema } from 'effect'
import { ConditionalReadCache, runClientEffect } from '@dovo/client-runtime'
import { conditionalReadSchema } from '@dovo/protocol'
const shared = new WeakMap<object, ConditionalReadCache<unknown>>()
type Read = <T extends Schema.Codec<unknown, unknown>>(
  path: string,
  input: unknown,
  schema: T,
) => Effect.Effect<T['Type'], Error>
const operations = new Set([
  '/api/scm/work/issues/list',
  '/api/scm/work/issues/detail',
  '/api/scm/work/options',
  '/api/scm/work/jira/boards',
  '/api/scm/work/jira/sprints',
])

/** Call after source verification. The key includes the verified account and destination. */
export function jiraReader(owner: object, scope: string, request: Read): Read {
  return (path, input, schema) => {
    if (
      !operations.has(path) ||
      !input ||
      typeof input !== 'object' ||
      !('jiraSourceId' in input) ||
      !input.jiraSourceId
    )
      return request(path, input, schema)
    const refresh = 'refresh' in input && input.refresh === true
    const parameters = Object.fromEntries(
      Object.entries(input).filter(([key]) => key !== 'refresh'),
    )
    let cache = shared.get(owner)
    if (!cache) {
      cache = new ConditionalReadCache<unknown>()
      shared.set(owner, cache)
    }
    const response = conditionalReadSchema(schema)
    return Effect.tryPromise({
      try: () =>
        cache.read(
          JSON.stringify([scope, path, parameters], (_key, value: unknown) =>
            value && typeof value === 'object' && !Array.isArray(value)
              ? Object.fromEntries(
                  Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
                )
              : value,
          ),
          (version) =>
            runClientEffect(
              request(
                path,
                { ...parameters, refresh, conditional: true, knownVersion: version },
                response,
              ),
            ).then((reply) => {
              if (
                reply &&
                typeof reply === 'object' &&
                'unchanged' in reply &&
                reply.unchanged === true &&
                'readVersion' in reply &&
                typeof reply.readVersion === 'string'
              )
                return { unchanged: true, version: reply.readVersion }
              if (
                reply &&
                typeof reply === 'object' &&
                'value' in reply &&
                'readVersion' in reply &&
                typeof reply.readVersion === 'string'
              )
                return { value: reply.value, version: reply.readVersion }
              return { value: reply }
            }),
          refresh === true,
        ),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }).pipe(
      Effect.flatMap((value) =>
        Schema.is(schema)(value)
          ? Effect.succeed(value)
          : Effect.fail(
              new Error(
                'The Jira response does not match the requested resource. Refresh the view.',
              ),
            ),
      ),
    )
  }
}

export function jiraPromiseReader(
  owner: object,
  scope: string,
  request: <T extends Schema.Codec<unknown, unknown>>(
    path: string,
    input: unknown,
    schema: T,
  ) => Promise<T['Type']>,
) {
  const read = jiraReader(owner, scope, (path, input, schema) =>
    Effect.tryPromise({
      try: () => request(path, input, schema),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }),
  )
  return <T extends Schema.Codec<unknown, unknown>>(path: string, input: unknown, schema: T) =>
    runClientEffect(read(path, input, schema))
}
