import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const machOMagic = new Set([
  0xfeedface,
  0xcefaedfe, // 32-bit
  0xfeedfacf,
  0xcffaedfe, // 64-bit
  0xcafebabe,
  0xbebafeca, // universal
  0xcafebabf,
  0xbfbafeca, // universal with 64-bit offsets
])

function isRuntimeData(file) {
  if (!statSync(file).isFile()) return false
  const descriptor = openSync(file, 'r')
  try {
    const header = Buffer.alloc(4)
    const bytes = readSync(descriptor, header, 0, header.length, 0)
    return bytes < header.length || !machOMagic.has(header.readUInt32BE())
  } finally {
    closeSync(descriptor)
  }
}

/** Opt in to our pinned osx-sign scheduler, retaining builder's identity handling and retries. */
export function configureMacSigning(packager) {
  const original = packager.doSign
  packager.doSign = function (options, ...rest) {
    const runtime = resolve(options.app, 'Contents/Resources/runtime') + sep
    const binaries = new Set(options.binaries?.map((file) => resolve(file)))
    return original.call(
      this,
      {
        ...options,
        signingConcurrency: 4,
        ignore: (file) => {
          if (options.ignore?.(file)) return true
          const path = resolve(file)
          // The enclosing app seals runtime data. Only native code needs its own signature.
          return path.startsWith(runtime) && !binaries.has(path) && isRuntimeData(path)
        },
      },
      ...rest,
    )
  }
}
