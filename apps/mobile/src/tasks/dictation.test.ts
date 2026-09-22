import { describe, expect, it, vi } from 'vite-plus/test'
import {
  createDictation,
  resolveDictationLocale,
  type DictationCallbacks,
  type DictationDriver,
  type DictationEvents,
} from './dictation'

function fixture() {
  let events: DictationEvents | undefined
  const driver: DictationDriver = {
    available: vi.fn<DictationDriver['available']>(() => true),
    supportsOnDevice: vi.fn<DictationDriver['supportsOnDevice']>(() => true),
    inactive: vi.fn<DictationDriver['inactive']>(async () => false),
    locales: vi.fn<DictationDriver['locales']>(async () => ({
      locales: ['en-US', 'nl-NL'],
      installedLocales: ['en_US', 'nl-NL'],
    })),
    permissions: vi.fn<DictationDriver['permissions']>(async () => ({ granted: true })),
    listen: vi.fn<DictationDriver['listen']>((handlers) => {
      events = handlers
      return vi.fn<() => void>()
    }),
    start: vi.fn<DictationDriver['start']>(() => events?.start()),
    stop: vi.fn<DictationDriver['stop']>(),
    abort: vi.fn<DictationDriver['abort']>(),
  }
  const callbacks: DictationCallbacks = {
    onResult: vi.fn<DictationCallbacks['onResult']>(),
    onFinish: vi.fn<DictationCallbacks['onFinish']>(),
    onError: vi.fn<(message: string) => void>(),
  }
  const dictation = createDictation(driver, () => ['en-US'], true)
  const result = (text: string, isFinal = false) =>
    events?.result({
      isFinal,
      results: text ? [{ transcript: text, confidence: 1, segments: [] }] : [],
    })
  return { driver, callbacks, dictation, result, events: () => events! }
}

describe('native dictation lifecycle', () => {
  it('resolves preferred speech languages without formatting extensions or unsupported regional tags', () => {
    expect(resolveDictationLocale(['nl-NL', 'en-NL'], ['en-GB', 'nl-NL'])).toBe('nl-NL')
    expect(resolveDictationLocale(['en_US-u-hc-h12'], ['en-US'])).toBe('en-US')
    expect(resolveDictationLocale(['en-NL'], ['nl-NL', 'en-GB'])).toBe('en-GB')
    expect(resolveDictationLocale(['en-NL', 'en-GB'], ['en-AU', 'en-GB'])).toBe('en-GB')
    expect(resolveDictationLocale(['zh-Hant-HK'], ['zh-Hans-CN', 'zh-Hant-TW'])).toBe('zh-Hant-TW')
    expect(resolveDictationLocale(['zz-ZZ', 'nl-NL'], ['en-US', 'nl-NL'])).toBe('nl-NL')
    expect(resolveDictationLocale(['nl_NL-u-ca-gregory'], [])).toBe('nl-NL')
  })

  it('uses the supported preferred language while leaving unconfirmed iOS models to the OS', async () => {
    const f = fixture()
    f.driver.locales = vi.fn<DictationDriver['locales']>(async () => ({
      locales: ['en-GB', 'nl-NL'],
      installedLocales: null,
    }))
    const dictation = createDictation(f.driver, () => ['nl-NL', 'en-NL'], true)
    await dictation.start(f.callbacks)
    expect(f.driver.start).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: 'nl-NL',
        requiresOnDeviceRecognition: false,
      }),
    )
    expect(f.driver.permissions).toHaveBeenCalledWith(false)
    expect(dictation.getSnapshot().onDeviceAvailable).toBeNull()
    f.events().end()
  })
  it('replaces interims, accumulates final segments, and finishes the full text exactly once', async () => {
    const f = fixture()
    await f.dictation.start(f.callbacks)
    expect(f.driver.start).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: 'en-US',
        requiresOnDeviceRecognition: true,
        recordingOptions: { persist: false },
      }),
    )
    expect(f.driver.permissions).toHaveBeenCalledWith(true)
    f.result('Fix')
    f.result('Fix the parser.')
    f.result('Fix the parser.', true)
    f.result(' Then')
    f.result(' Then add tests.', true)
    f.result('', true)
    expect(f.callbacks.onResult).toHaveBeenLastCalledWith('Fix the parser. Then add tests.')
    f.dictation.stop()
    expect(f.driver.stop).toHaveBeenCalledOnce()
    expect(f.callbacks.onFinish).not.toHaveBeenCalled()
    expect(f.dictation.getSnapshot().isStopping).toBe(true)
    f.events().end()
    f.events().end()
    expect(f.callbacks.onFinish).toHaveBeenCalledExactlyOnceWith('Fix the parser. Then add tests.')
    expect(f.dictation.getSnapshot()).toMatchObject({
      isRecording: false,
      isStarting: false,
      isStopping: false,
    })
  })

  it('preserves the latest partial result when interrupted, without silently discarding it', async () => {
    const f = fixture()
    await f.dictation.start(f.callbacks)
    f.result('Keep this unfinished thought')
    f.events().error({ error: 'interrupted', message: 'Phone call' })
    f.events().audioend()
    f.events().end()
    expect(f.callbacks.onFinish).toHaveBeenCalledExactlyOnceWith('Keep this unfinished thought')
    expect(f.dictation.getSnapshot().error).toContain('interrupted')
  })

  it('recovers when native construction fails without an end event and is confirmed inactive', async () => {
    const f = fixture()
    f.driver.start = vi.fn<DictationDriver['start']>()
    f.driver.inactive = vi.fn<DictationDriver['inactive']>(async () => true)
    await f.dictation.start(f.callbacks)
    expect(f.dictation.getSnapshot().isStarting).toBe(true)
    f.events().error({ error: 'not-allowed', message: 'Could not create recognizer' })
    await vi.waitFor(() => expect(f.dictation.getSnapshot().isStarting).toBe(false))
    expect(f.callbacks.onFinish).toHaveBeenCalledExactlyOnceWith('')
    expect(f.dictation.getSnapshot().permissionDenied).toBe(true)
    await f.dictation.start(f.callbacks)
    expect(f.driver.start).toHaveBeenCalledTimes(2)
    f.events().end()
  })

  it('does not release another recording when an old error recovery resolves late', async () => {
    const f = fixture()
    let resolveState: (inactive: boolean) => void = () => undefined
    f.driver.inactive = vi.fn<DictationDriver['inactive']>(
      () =>
        new Promise<boolean>((resolve) => {
          resolveState = resolve
        }),
    )
    await f.dictation.start(f.callbacks)
    f.events().error({ error: 'interrupted', message: 'Interrupted' })
    f.events().end()
    await f.dictation.start(f.callbacks)
    resolveState(true)
    await Promise.resolve()
    expect(f.dictation.getSnapshot().isRecording).toBe(true)
    expect(f.callbacks.onFinish).toHaveBeenCalledOnce()
    f.events().end()
  })

  it('cancel aborts and rejects final results while waiting for native teardown', async () => {
    const f = fixture()
    await f.dictation.start(f.callbacks)
    f.result('Discard me')
    f.dictation.cancel()
    f.result('Discard me.', true)
    expect(f.driver.abort).toHaveBeenCalledOnce()
    await f.dictation.start(f.callbacks)
    expect(f.driver.start).toHaveBeenCalledOnce()
    f.events().error({ error: 'aborted', message: 'Canceled' })
    f.events().end()
    expect(f.callbacks.onFinish).not.toHaveBeenCalled()
    expect(f.callbacks.onResult).toHaveBeenCalledTimes(1)
    expect(f.dictation.getSnapshot().error).toBeNull()
  })

  it('cancel during permission request prevents a late grant from opening the microphone', async () => {
    const f = fixture()
    let grant: (value: { granted: boolean }) => void = () => undefined
    f.driver.permissions = vi.fn<DictationDriver['permissions']>(
      () =>
        new Promise<{ granted: boolean }>((resolve) => {
          grant = resolve
        }),
    )
    const starting = f.dictation.start(f.callbacks)
    await vi.waitFor(() => expect(f.driver.permissions).toHaveBeenCalledOnce())
    f.dictation.cancel()
    grant({ granted: true })
    await starting
    expect(f.driver.start).not.toHaveBeenCalled()
    expect(f.callbacks.onFinish).not.toHaveBeenCalled()
    expect(f.dictation.getSnapshot().isStarting).toBe(false)
  })

  it('denied permission is actionable and never starts native recording', async () => {
    const f = fixture()
    f.driver.permissions = vi.fn<DictationDriver['permissions']>(async () => ({ granted: false }))
    await f.dictation.start(f.callbacks)
    expect(f.driver.start).not.toHaveBeenCalled()
    expect(f.dictation.getSnapshot()).toMatchObject({ isStarting: false, permissionDenied: true })
    expect(f.dictation.getSnapshot().error).toContain('Settings')
    expect(f.callbacks.onFinish).not.toHaveBeenCalled()
  })

  it('does not allow another mounted conversation to own the same microphone', async () => {
    const f = fixture()
    const other = createDictation(f.driver, () => ['nl-NL'], true)
    await f.dictation.start(f.callbacks)
    await other.start(f.callbacks)
    expect(f.driver.start).toHaveBeenCalledOnce()
    expect(other.getSnapshot().error).toContain('Another dictation')
    f.events().end()
    await other.start(f.callbacks)
    expect(f.driver.start).toHaveBeenCalledTimes(2)
    other.cancel()
    f.events().end()
  })

  it('ignores stale native handlers and never retargets a previous session callback', async () => {
    const f = fixture()
    await f.dictation.start(f.callbacks)
    const oldEvents = f.events()
    f.result('First', true)
    oldEvents.end()
    const next = {
      onResult: vi.fn<DictationCallbacks['onResult']>(),
      onFinish: vi.fn<DictationCallbacks['onFinish']>(),
    }
    await f.dictation.start(next)
    oldEvents.result({
      isFinal: true,
      results: [{ transcript: 'Late old text', confidence: 1, segments: [] }],
    })
    oldEvents.end()
    f.result('Second', true)
    f.events().end()
    expect(f.callbacks.onFinish).toHaveBeenCalledExactlyOnceWith('First')
    expect(next.onFinish).toHaveBeenCalledExactlyOnceWith('Second')
  })

  it('unmount aborts without callbacks and supports StrictMode effect reactivation', async () => {
    const f = fixture()
    await f.dictation.start(f.callbacks)
    f.result('Before unmount')
    f.dictation.dispose()
    f.result('Late text', true)
    f.events().end()
    expect(f.callbacks.onFinish).not.toHaveBeenCalled()
    f.dictation.activate()
    await f.dictation.start(f.callbacks)
    f.result('After remount', true)
    f.events().end()
    expect(f.callbacks.onFinish).toHaveBeenCalledExactlyOnceWith('After remount')
  })

  it('reports offline locale availability and uses the online recognizer if the model is absent', async () => {
    const f = fixture()
    f.driver.locales = vi.fn<DictationDriver['locales']>(async () => ({
      locales: ['en-US', 'fr-FR'],
      installedLocales: ['fr-FR'],
    }))
    await f.dictation.start(f.callbacks)
    expect(f.dictation.getSnapshot().onDeviceAvailable).toBe(false)
    expect(f.driver.permissions).toHaveBeenCalledWith(false)
    expect(f.driver.start).toHaveBeenCalledWith(
      expect.objectContaining({ requiresOnDeviceRecognition: false }),
    )
    f.events().end()
  })

  it('bounds an unresponsive offline-capability query without blocking online dictation', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture()
      f.driver.locales = vi.fn<DictationDriver['locales']>(
        () => new Promise<{ locales: string[]; installedLocales: string[] }>(() => undefined),
      )
      const starting = f.dictation.start(f.callbacks)
      await vi.advanceTimersByTimeAsync(3000)
      await starting
      expect(f.dictation.getSnapshot().onDeviceAvailable).toBeNull()
      expect(f.driver.start).toHaveBeenCalledOnce()
      f.events().end()
    } finally {
      vi.useRealTimers()
    }
  })

  it('gracefully explains builds without the native module', async () => {
    const f = fixture()
    const missing = createDictation(null, () => ['en-US'], false)
    await missing.start(f.callbacks)
    expect(missing.getSnapshot().available).toBe(false)
    expect(missing.getSnapshot().error).toContain('latest app build')
  })
})
