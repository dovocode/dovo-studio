import { vi } from 'vite-plus/test'

// These tests exercise real Git processes and SQLite as well as owned background workers.
// Completion is a state assertion, not a one-second performance contract.
export const runtimeIntegration = { testTimeout: 30_000 }
export const waitForRuntime = <T>(assertion: () => T) => vi.waitFor(assertion, { timeout: 10_000 })

export function deferred<T>() {
  let resolve = (_value: T) => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
