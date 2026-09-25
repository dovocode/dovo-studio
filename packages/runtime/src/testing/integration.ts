import { vi } from 'vitest'

// These tests exercise real Git processes and SQLite as well as owned background workers.
// Completion is a state assertion, not a one-second performance contract.
export const runtimeIntegration = { testTimeout: 30_000 }
export const waitForRuntime = <T>(assertion: () => T) => vi.waitFor(assertion, { timeout: 10_000 })
