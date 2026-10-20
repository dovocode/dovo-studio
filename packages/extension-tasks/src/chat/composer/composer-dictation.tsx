import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  desktopDictationBridge,
  dictationStatusSchema,
  dictationUpdateSchema,
  decode,
  randomUUID,
} from '@dovo/protocol'
import { useAppPreferences } from '@dovo/studio-core'
import { Button, IconButton } from '@dovo/studio-ui'
import { Mic, Square, X, LoaderCircle } from 'lucide-react'
import type { createComposerDraft } from './composer-draft'
import { recordDictation, insertDictation } from './dictation-audio'

type Session = {
  id: string
  abort: AbortController
  finishing?: boolean
  unsubscribe?: () => void
  pending: Promise<void>
  recorder?: Awaited<ReturnType<typeof recordDictation>>
  draft: string
  start: number
  end: number
}
export function ComposerDictation({
  controller,
  input,
  disabled,
  onActive,
}: {
  controller: ReturnType<typeof createComposerDraft>
  input: RefObject<HTMLTextAreaElement | null>
  disabled: boolean
  onActive: (active: boolean) => void
}) {
  const bridge = desktopDictationBridge()
  const { dictationEnabled, dictationLanguage } = useAppPreferences()
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'transcribing'>('idle')
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [retained, setRetained] = useState('')
  const active = useRef<Session | null>(null)
  const mounted = useRef(true)
  const callbacks = useRef({ onActive })
  callbacks.current = { onActive }
  const stopRef = useRef<() => Promise<void>>(async () => {})
  const cancel = useCallback(() => {
    const session = active.current
    active.current = null
    session?.abort.abort()
    session?.recorder?.cancel()
    session?.unsubscribe?.()
    if (session && bridge)
      void bridge.cancel(session.id).catch((cause: unknown) => {
        if (mounted.current) setError(`Could not confirm dictation stopped: ${String(cause)}`)
      })
    callbacks.current.onActive(false)
    if (mounted.current) setPhase('idle')
  }, [bridge])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      cancel()
    }
  }, [controller, cancel])
  useEffect(() => {
    if (!disabled && dictationEnabled) return
    cancel()
  }, [disabled, dictationEnabled, cancel])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && active.current) {
        event.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [cancel])

  const session = (): Session => ({
    id: randomUUID(),
    abort: new AbortController(),
    pending: Promise.resolve(),
    draft: controller.text,
    start: input.current?.selectionStart ?? controller.text.length,
    end: input.current?.selectionEnd ?? controller.text.length,
  })
  const finish = async () => {
    const current = active.current
    if (!current?.recorder || current.finishing || !bridge || phase !== 'recording') return
    current.finishing = true
    setPhase('transcribing')
    try {
      await current.recorder.stop()
      await current.pending
      if (active.current !== current) return
      const text = await bridge.finish(current.id)
      if (active.current !== current || !mounted.current) return
      if (typeof text !== 'string' || !text.trim())
        throw new Error('No speech was detected. Please try again.')
      if (controller.text === current.draft) {
        controller.update(insertDictation(current.draft, text, current.start, current.end))
        input.current?.focus()
      } else {
        setRetained(text)
        setError('Your draft changed during dictation. Review the transcript before inserting it.')
      }
    } catch (cause) {
      if (active.current === current && mounted.current) {
        cancel()
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      current.unsubscribe?.()
      if (active.current === current) {
        active.current = null
        callbacks.current.onActive(false)
        if (mounted.current) setPhase('idle')
      }
    }
  }
  stopRef.current = finish
  const start = async () => {
    if (!bridge || disabled || !dictationEnabled || active.current) return
    const current = session()
    active.current = current
    setError('')
    setPreview('')
    setPhase('starting')
    callbacks.current.onActive(true)
    try {
      const value = decode(dictationStatusSchema, await bridge.status())
      if (active.current !== current) return
      if (!value.engine || !value.model)
        throw new Error('Download and enable dictation in Settings → General → Speech.')
      const fail = (cause: Error) => {
        if (active.current !== current) return
        cancel()
        setError(cause.message)
      }
      current.unsubscribe = bridge.subscribe(current.id, (value) => {
        if (active.current !== current || !mounted.current) return
        try {
          const update = decode(dictationUpdateSchema, value)
          if (update.type === 'error') fail(new Error(update.message))
          else setPreview(update.text)
        } catch (cause) {
          fail(cause instanceof Error ? cause : new Error(String(cause)))
        }
      })
      await bridge.start(current.id, dictationLanguage)
      if (active.current !== current) return
      current.recorder = await recordDictation(
        current.abort.signal,
        () => void stopRef.current(),
        fail,
        (pcm) => {
          current.pending = current.pending
            .then(async () => {
              if (active.current === current) await bridge.feed(current.id, pcm)
            })
            .catch((cause: unknown) =>
              fail(cause instanceof Error ? cause : new Error(String(cause))),
            )
        },
      )
      if (active.current !== current) {
        current.recorder.cancel()
        return
      }
      setPhase('recording')
    } catch (cause) {
      if (active.current !== current) return
      cancel()
      setError(
        cause instanceof Error && cause.name === 'NotAllowedError'
          ? 'Allow microphone access for Dovo Studio in system settings, then try again.'
          : cause instanceof Error
            ? cause.message
            : String(cause),
      )
    }
  }
  if (!bridge || !dictationEnabled) return null
  const busy = !['idle', 'recording'].includes(phase)
  return (
    <div className="relative flex items-center gap-1">
      <IconButton
        type="button"
        className="size-7"
        label={
          phase === 'recording'
            ? 'Stop dictation'
            : busy
              ? 'Dictation in progress'
              : 'Dictate message'
        }
        disabled={disabled || busy || !!retained}
        onClick={() => void (phase === 'recording' ? finish() : start())}
      >
        {phase === 'recording' ? (
          <Square className="size-3.5 text-red-400" />
        ) : busy ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <Mic className="size-3.5" />
        )}
      </IconButton>
      {(phase !== 'idle' || error || retained) && (
        <div
          className="absolute bottom-full right-0 z-30 mb-2 w-72 rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg"
          aria-label="Local dictation"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <strong>Local dictation</strong>
            <IconButton
              type="button"
              className="size-6"
              label="Cancel dictation"
              onClick={() => {
                cancel()
                setError('')
                setRetained('')
              }}
            >
              <X className="size-3" />
            </IconButton>
          </div>
          <div role="status" aria-live="polite">
            {phase === 'starting' && <p>Loading speech model and opening microphone…</p>}
            {phase === 'recording' && (
              <p>Recording… Click Stop when finished. Escape cancels. Maximum 5 minutes.</p>
            )}
            {phase === 'transcribing' && <p>Transcribing on this computer…</p>}
          </div>
          {error && (
            <p role="alert" className="mt-2 text-destructive">
              {error}
            </p>
          )}
          {(phase === 'recording' || phase === 'transcribing') && preview && (
            <textarea
              aria-label="Live dictation preview"
              readOnly
              value={preview}
              className="mt-2 max-h-40 w-full rounded border border-border bg-background p-2"
            />
          )}
          {retained && (
            <>
              <textarea
                aria-label="Dictation transcript"
                readOnly
                value={retained}
                className="mt-2 max-h-40 w-full rounded border border-border bg-background p-2"
              />
              <Button
                type="button"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  controller.update(
                    insertDictation(
                      controller.text,
                      retained,
                      input.current?.selectionStart ?? controller.text.length,
                      input.current?.selectionEnd ?? controller.text.length,
                    ),
                  )
                  setRetained('')
                  setError('')
                  input.current?.focus()
                }}
              >
                Insert transcript
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
