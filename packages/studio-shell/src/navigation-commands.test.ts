import { expect, it, vi } from 'vite-plus/test'
import { threadCommands, type StudioCommand, type StudioHostApi } from '@dovo/studio-core'
import { tasksExtension } from '../../extension-tasks/src/index'
import { appSettingsExtension } from './app-extension'
import { createExtensionCatalog } from './extension-catalog'
import {
  navigationViewVisible,
  paletteCommands,
  type NavigationAvailability,
} from './navigation-commands'

const availability: NavigationAvailability = {
  botsOverviewEnabled: false,
  browserWorkspaceEnabled: true,
  unifiedWorkspaceEnabled: false,
  unifiedWorkspaceHideNormalModes: false,
  artifactsEnabled: false,
  showIssues: false,
  showJira: false,
}

/** The shipped Threads and app settings views, with every registration the extensions make. */
async function shippedCatalog() {
  const registered = new Map<string, StudioCommand>()
  const api: StudioHostApi = {
    navigate: vi.fn<StudioHostApi['navigate']>(),
    registerCommand: (command) => {
      registered.set(command.id, command)
      return () => registered.delete(command.id)
    },
  }
  const catalog = createExtensionCatalog([appSettingsExtension, tasksExtension], api)
  await catalog.host.activate(appSettingsExtension.manifest.id)
  await catalog.host.activate(tasksExtension.manifest.id)
  return { catalog, registered, api }
}

function palette(
  catalog: Awaited<ReturnType<typeof shippedCatalog>>['catalog'],
  registered: Iterable<StudioCommand>,
  options: Partial<NavigationAvailability> = {},
) {
  const openSection = vi.fn<(viewId: string) => void>()
  const openThreadCommand = vi.fn<(id: string) => void>()
  const commands = paletteCommands({
    views: catalog.views,
    availability: { ...availability, ...options },
    openSection,
    threadCommands: Object.values(threadCommands),
    openThreadCommand,
    extra: [],
    registered,
  })
  return { commands, openSection, openThreadCommand }
}

it('offers one Open Browser entry that uses the sidebar action', async () => {
  const { catalog, registered, api } = await shippedCatalog()
  const { commands, openSection } = palette(catalog, registered.values())
  expect(commands.filter((command) => command.title === 'Open Browser')).toHaveLength(1)
  expect(commands.map((command) => command.title)).toContain('Open Browser settings')
  commands.find((command) => command.title === 'Open Browser')!.run()
  // The sidebar action focuses a detached browser window before it navigates.
  expect(openSection).toHaveBeenCalledWith('browser')
  expect(api.navigate).not.toHaveBeenCalled()
  await catalog.host.dispose()
})

it('offers Bots only while the sidebar shows Bots', async () => {
  const { catalog, registered } = await shippedCatalog()
  expect(
    palette(catalog, registered.values()).commands.some((command) => command.title === 'Open Bots'),
  ).toBe(false)
  expect(
    palette(catalog, registered.values(), { botsOverviewEnabled: true }).commands.some(
      (command) => command.title === 'Open Bots',
    ),
  ).toBe(true)
  await catalog.host.dispose()
})

it('keeps thread actions in views that do not register them, and prefers the mounted view', async () => {
  const { catalog, registered } = await shippedCatalog()
  // The Terminals view registers no thread commands.
  const terminal = palette(catalog, registered.values())
  const titles = terminal.commands.map((command) => command.title)
  expect(titles.filter((title) => title === 'New thread')).toHaveLength(1)
  expect(titles).toContain('Search conversations…')
  expect(titles).toContain('Go to thread…')
  terminal.commands.find((command) => command.title === 'Search conversations…')!.run()
  expect(terminal.openThreadCommand).toHaveBeenCalledWith('tasks.search')

  // The Threads view registers the same IDs. Its own action replaces the fallback.
  const run = vi.fn<() => void>()
  const threads = palette(catalog, [{ ...threadCommands.newThread, run }])
  const newThread = threads.commands.filter((command) => command.id === 'tasks.new')
  expect(newThread).toHaveLength(1)
  newThread[0].run()
  expect(run).toHaveBeenCalledOnce()
  expect(threads.openThreadCommand).not.toHaveBeenCalled()

  // Hidden Threads hides its actions too, as in the sidebar.
  const hidden = palette(catalog, registered.values(), {
    unifiedWorkspaceEnabled: true,
    unifiedWorkspaceHideNormalModes: true,
  })
  expect(hidden.commands.some((command) => command.id === 'tasks.new')).toBe(false)
  await catalog.host.dispose()
})

it('uses one visibility rule for sidebar sections', () => {
  const view = (id: string) => ({ id })
  expect(navigationViewVisible(view('bots'), availability)).toBe(false)
  expect(navigationViewVisible(view('tasks'), availability)).toBe(true)
  expect(navigationViewVisible({ id: 'pipelines', navigationGroup: 'hidden' }, availability)).toBe(
    false,
  )
  expect(
    navigationViewVisible(view('browser'), { ...availability, browserWorkspaceEnabled: false }),
  ).toBe(false)
})
