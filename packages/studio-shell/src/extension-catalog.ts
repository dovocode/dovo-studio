import { ExtensionHost } from '@dovo/client-runtime'
import type { StudioExtension, StudioHostApi } from '@dovo/studio-core'

export function createExtensionCatalog(extensions: readonly StudioExtension[], api: StudioHostApi) {
  const host = new ExtensionHost()
  const ids = new Set<string>()
  const views = extensions
    .flatMap((extension) => {
      host.register(extension.createRuntime(api))
      return extension.views.map((view) => {
        if (ids.has(view.id)) throw new Error(`Duplicate contributed view: ${view.id}`)
        ids.add(view.id)
        return {
          ...view,
          extensionId: extension.manifest.id,
          load: async () => {
            await host.activate(extension.manifest.id)
            return view.load()
          },
        }
      })
    })
    .sort((a, b) => a.order - b.order)
  return { host, views }
}
