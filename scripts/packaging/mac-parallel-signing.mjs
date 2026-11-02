/** Opt in to our pinned osx-sign scheduler, retaining builder's identity handling and retries. */
export function configureMacSigning(packager) {
  const original = packager.doSign
  packager.doSign = function (options, ...rest) {
    return original.call(this, { ...options, signingConcurrency: 4 }, ...rest)
  }
}
