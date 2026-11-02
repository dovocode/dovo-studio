import { createRequire } from 'node:module'

function installedTransport() {
  const builder = createRequire(createRequire(import.meta.url).resolve('electron-builder'))
  const packager = createRequire(builder.resolve('app-builder-lib'))
  const notarize = createRequire(packager.resolve('@electron/notarize'))
  return notarize('./spawn.js')
}

/**
 * Keep electron-notarize's authentication, validation, submission and retry logic.
 * Only its temporary upload ZIP uses faster compression; distributed archives are unchanged.
 * The pinned library calls this CommonJS export for each subprocess (guarded by tests).
 */
export function configureMacNotarization(timing, transport = installedTransport()) {
  const original = transport.spawn
  transport.spawn = async function (command, args = [], ...rest) {
    const zip = command === 'ditto' && args.includes('-c') && args.includes('-k')
    const label = zip
      ? 'Notarization ZIP (compression level 1)'
      : command === 'codesign'
        ? 'Notarization signature verification'
        : command === 'xcrun' && args[0] === 'notarytool' && args[1] === 'submit'
          ? 'Notarization upload and Apple processing'
          : command === 'xcrun' && args[0] === 'stapler'
            ? 'Notarization stapling'
            : undefined
    const end = label ? timing.start(label) : undefined
    try {
      const result = await original.call(
        this,
        command,
        zip ? ['--zlibCompressionLevel', '1', ...args] : args,
        ...rest,
      )
      end?.(result.code === 0 ? 'ok' : 'failed')
      return result
    } catch (error) {
      end?.('failed')
      throw error
    }
  }
  return () => {
    transport.spawn = original
  }
}
