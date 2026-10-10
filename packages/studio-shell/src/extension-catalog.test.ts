import { expect, it, vi } from 'vite-plus/test'
import { defineStudioExtension, type StudioHostApi, type StudioView } from '@dovo/studio-core'
import { createExtensionCatalog } from './extension-catalog'
it('contributes views before loading and disposes activated commands', async () => {
  const unregister = vi.fn<() => void>()
  const api: StudioHostApi = {
    navigate: vi.fn<StudioHostApi['navigate']>(),
    registerCommand: vi.fn<StudioHostApi['registerCommand']>(() => unregister),
  }
  const load = vi.fn<StudioView['load']>(async () => ({ default: () => null }))
  const extension = defineStudioExtension({ id: 'feature', name: 'Feature', version: '1' }, [
    { id: 'feature.view', title: 'Feature', icon: 'tasks', order: 0, load },
  ])
  const catalog = createExtensionCatalog([extension], api)
  expect(catalog.views[0].id).toBe('feature.view')
  expect(load).not.toHaveBeenCalled()
  expect(catalog.host.get('feature')?.state).toBe('registered')
  await catalog.views[0].load()
  expect(load).toHaveBeenCalledOnce()
  expect(catalog.host.get('feature')?.state).toBe('active')
  expect(api.registerCommand).toHaveBeenCalledOnce()
  await catalog.host.dispose()
  expect(unregister).toHaveBeenCalledOnce()
})

it('keeps detail-only views addressable without contributing navigation commands', async () => {
  const api: StudioHostApi = {
    navigate: vi.fn<StudioHostApi['navigate']>(),
    registerCommand: vi.fn<StudioHostApi['registerCommand']>(() => () => {}),
  }
  const extension = defineStudioExtension({ id: 'scm', name: 'SCM', version: '1' }, [
    {
      id: 'pulls',
      title: 'Pull requests',
      icon: 'pulls',
      order: 0,
      load: async () => ({ default: () => null }),
    },
    {
      id: 'pipelines',
      title: 'Pipelines',
      icon: 'pipelines',
      navigationGroup: 'hidden',
      order: 1,
      load: async () => ({ default: () => null }),
    },
  ])
  expect(extension.manifest.contributes?.commands?.map((command) => command.command)).toEqual([
    'scm.open.pulls',
  ])
  const catalog = createExtensionCatalog([extension], api)
  const pipeline = catalog.views.find((view) => view.id === 'pipelines')
  expect(pipeline).toBeDefined()
  await pipeline!.load()
  expect(api.registerCommand).toHaveBeenCalledOnce()
  expect(api.registerCommand).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'scm.open.pulls' }),
  )
  await catalog.host.dispose()
})

it('registers all shipped settings and feature views without ID collisions', async () => {
  const [
    { appSettingsExtension },
    { runtimeExtension },
    { tasksExtension },
    { scmExtension },
    { agentsExtension },
    { jobsExtension },
  ] = await Promise.all([
    import('../../studio-shell/src/app-extension'),
    import('../../extension-runtime/src/index'),
    import('../../extension-tasks/src/index'),
    import('../../extension-scm/src/index'),
    import('../../extension-agents/src/index'),
    import('../../extension-jobs/src/index'),
  ])
  const api: StudioHostApi = {
    navigate: vi.fn<StudioHostApi['navigate']>(),
    registerCommand: vi.fn<StudioHostApi['registerCommand']>(() => () => {}),
  }
  const catalog = createExtensionCatalog(
    [
      appSettingsExtension,
      tasksExtension,
      scmExtension,
      agentsExtension,
      jobsExtension,
      runtimeExtension,
    ],
    api,
  )
  expect(catalog.views.find((view) => view.id === 'pull-request-settings')?.title).toBe(
    'Pull requests',
  )
  expect(catalog.views.find((view) => view.id === 'pull-request-monitoring-settings')?.title).toBe(
    'Pull requests & pipelines',
  )
  await catalog.host.dispose()
})
