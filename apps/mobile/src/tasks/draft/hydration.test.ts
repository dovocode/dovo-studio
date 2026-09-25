import { Deferred, Effect, Fiber } from 'effect'
import { describe, expect, it } from 'vite-plus/test'
import { hydrateDraft } from './hydration'

const current = { initial: () => 'Task draft', edited: () => false }

describe('draft hydration', () => {
  it('falls back to the task draft when local storage fails', async () => {
    await expect(
      Effect.runPromise(hydrateDraft(Effect.fail(new Error('Unavailable')), current)),
    ).resolves.toEqual({ text: 'Task draft', error: 'Error: Unavailable' })
  })

  it('retains an explicitly empty saved draft', async () => {
    await expect(Effect.runPromise(hydrateDraft(Effect.succeed(''), current))).resolves.toEqual({
      text: '',
      error: '',
    })
  })

  it('checks for newer edits after the pending storage read finishes', async () => {
    const pending = Effect.runSync(Deferred.make<string | null>())
    let edited = false
    const hydration = Effect.runFork(
      hydrateDraft(Deferred.await(pending), {
        ...current,
        edited: () => edited,
      }),
    )
    edited = true
    await Effect.runPromise(Deferred.succeed(pending, 'Older saved draft'))
    await expect(Effect.runPromise(Fiber.join(hydration))).resolves.toEqual({
      text: undefined,
      error: '',
    })
  })

  it('does not apply fallback text when the owning screen is disposed', async () => {
    let applied = false
    const pending = Effect.runSync(Deferred.make<string | null>())
    const hydration = Effect.runFork(
      hydrateDraft(Effect.uninterruptible(Deferred.await(pending)), current).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            applied = true
          }),
        ),
      ),
    )
    const closing = Effect.runPromise(Fiber.interrupt(hydration))
    await Effect.runPromise(Deferred.succeed(pending, 'Saved draft'))
    await closing
    expect(applied).toBe(false)
  })
})
