import type { Extension } from './types.js'

export const CORE_EXTENSION_ID = 'dovo.core'

export function createCoreExtension(): Extension {
  return {
    manifest: {
      id: CORE_EXTENSION_ID,
      name: 'Dovo Core',
      version: '0.1.0',
      description: 'The extension host foundation shared by every Dovo surface.',
      activationEvents: ['onStartupFinished'],
      contributes: {
        commands: [{ command: 'dovo.runtime.ping', title: 'Ping runtime', category: 'Runtime' }],
      },
    },
    activate: async (context) => {
      context.commands.registerCommand('dovo.runtime.ping', () => ({ ok: true }))
      await context.events.emit('runtime:core-ready', { extensionId: context.extension.id })
    },
  }
}
