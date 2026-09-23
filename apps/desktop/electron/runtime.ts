import { Context, Effect, Layer } from 'effect'

import { createCoreExtension, ExtensionHost, type ExtensionInfo } from '@dovo/client-runtime'

interface DesktopRuntime {
  readonly host: ExtensionHost
}

export class DesktopRuntimeTag extends Context.Tag('DovoDesktopRuntime')<
  DesktopRuntimeTag,
  DesktopRuntime
>() {}

const desktopRuntime = (): DesktopRuntime => {
  const host = new ExtensionHost()
  host.register(createCoreExtension())
  return { host }
}

export const desktopRuntimeLayer = Layer.succeed(DesktopRuntimeTag, desktopRuntime())

export function runDesktop<A, E>(program: Effect.Effect<A, E, DesktopRuntimeTag>): Promise<A> {
  return Effect.runPromise(program.pipe(Effect.provide(desktopRuntimeLayer)))
}

export const listExtensions = Effect.gen(function* () {
  const { host } = yield* DesktopRuntimeTag
  return host.list()
})

export const activateOnStartup = Effect.gen(function* () {
  const { host } = yield* DesktopRuntimeTag
  yield* host.activateByEventEffect('onStartupFinished')
})

export const activateExtension = (id: string) =>
  Effect.gen(function* () {
    const { host } = yield* DesktopRuntimeTag
    yield* host.activateEffect(id)
    const info = host.get(id)
    if (!info) return yield* Effect.fail(new Error(`Extension is not registered: ${id}`))
    return info
  })

export const disposeRuntime = Effect.gen(function* () {
  const { host } = yield* DesktopRuntimeTag
  yield* host.disposeEffect()
})

export type { ExtensionInfo }
