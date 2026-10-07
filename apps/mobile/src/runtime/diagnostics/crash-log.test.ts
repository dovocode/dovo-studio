import { beforeEach, expect, it, vi } from 'vite-plus/test'

const store = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: async (key: string) => {
      store.delete(key)
    },
  },
}))
beforeEach(() => store.clear())

it('records fatal errors and unhandled rejections once and hands them to the previous handler', async () => {
  const { installCrashRecorder, readLastCrash, clearLastCrash } = await import('./crash-log')
  const previous = vi.fn<(error: unknown, fatal?: boolean) => void>()
  let handler: ((error: unknown, fatal?: boolean) => void) | undefined
  let tracker: { onUnhandled: (id: number, error: unknown) => void } | undefined
  Object.assign(globalThis, {
    ErrorUtils: {
      getGlobalHandler: () => previous,
      setGlobalHandler: (next: typeof handler) => {
        handler = next
      },
    },
    HermesInternal: {
      enablePromiseRejectionTracker: (options: typeof tracker) => {
        tracker = options
      },
    },
  })
  installCrashRecorder()
  installCrashRecorder()
  handler?.(new Error('Boom'), true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(previous).toHaveBeenCalledWith(expect.any(Error), true)
  expect(await readLastCrash()).toMatchObject({ message: 'Error: Boom', fatal: true })
  tracker?.onUnhandled(1, 'lost promise')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(await readLastCrash()).toMatchObject({ message: 'lost promise', fatal: false })
  await clearLastCrash()
  expect(await readLastCrash()).toBeNull()
})
