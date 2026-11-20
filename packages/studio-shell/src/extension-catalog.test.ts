import { expect, it, vi } from 'vite-plus/test'
import { defineStudioExtension, type StudioHostApi, type StudioView } from '@dovo/studio-core'
import { runtimeExtension } from '../../extension-runtime/src/index'
import { tasksExtension } from '../../extension-tasks/src/index'
import { scmExtension } from '../../extension-scm/src/index'
import { agentsExtension } from '../../extension-agents/src/index'
import { jobsExtension } from '../../extension-jobs/src/index'
import { appSettingsExtension } from './app-extension'
import { createExtensionCatalog } from './extension-catalog'
it('contributes views before loading and disposes activated commands', async () => {
  const api: StudioHostApi = {
    navigate: vi.fn<StudioHostApi['navigate']>(),
    registerCommand: vi.fn<StudioHostApi['registerCommand']>(() => () => {}),
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
  // The workbench builds palette entries with sidebar rules, so activation adds none of its own.
  expect(api.registerCommand).not.toHaveBeenCalled()
  await catalog.host.executeCommand('feature.open.feature.view')
  expect(api.navigate).toHaveBeenCalledWith({ viewId: 'feature.view' })
  await catalog.host.dispose()
  await expect(catalog.host.executeCommand('feature.open.feature.view')).rejects.toThrow()
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
  await catalog.host.executeCommand('scm.open.pulls')
  expect(api.navigate).toHaveBeenCalledWith({ viewId: 'pulls' })
  await expect(catalog.host.executeCommand('scm.open.pipelines')).rejects.toThrow()
  await catalog.host.dispose()
})
it('activates settings without loading the settings component', async () => {
  const registerCommand = vi.fn<StudioHostApi['registerCommand']>(() => () => {})
  const navigate = vi.fn<StudioHostApi['navigate']>()
  const load = vi.fn<StudioView['load']>(async () => ({ default: () => null }))
  const extension = defineStudioExtension({ id: 'settings', name: 'Settings', version: '1' }, [
    {
      id: 'appearance',
      title: 'Appearance',
      icon: 'runtime',
      order: 0,
      navigationGroup: 'settings',
      keywords: 'fonts typography themes',
      load,
    },
  ])
  const catalog = createExtensionCatalog([extension], { navigate, registerCommand })
  await catalog.host.activate('settings')
  await catalog.host.executeCommand('settings.open.appearance')
  expect(load).not.toHaveBeenCalled()
  expect(registerCommand).not.toHaveBeenCalled()
  expect(navigate).toHaveBeenCalledWith({ viewId: 'appearance' })
  await catalog.host.dispose()
})

it('registers all shipped settings and feature views without ID collisions', async () => {
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
  expect(catalog.views.some((view) => view.id === 'pull-request-settings')).toBe(false)
  expect(catalog.views.find((view) => view.id === 'pull-request-monitoring-settings')?.title).toBe(
    'Pull requests & pipelines',
  )
  await catalog.host.dispose()
})
