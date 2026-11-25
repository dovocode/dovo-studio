import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { useCallback, useEffect, useRef } from 'react'
import { Alert, Keyboard } from 'react-native'
import { useIsFocused } from 'expo-router'
import { useMobileDictation } from './dictation-provider'
import { useRuntime } from '../../runtime/connection/provider'
import { useMobilePreferences } from '../../runtime/preferences/app-preferences'
import { drafts } from '../draft/runtime-drafts'
import { DictationDraftEdit, type DraftSelection } from './dictation-draft'
type Cleanup = {
  status: 'cleaning' | 'failed' | 'done'
  raw: string
  transcript: string
  cleaned?: string
  error?: string
}
export function useComposerDictation({
  taskId,
  title,
  editing,
  draftKey,
  draft,
  cleanup,
  connected,
  transient = false,
}: {
  taskId: string
  title: string
  editing: boolean
  draftKey: string
  draft: {
    text: string
    update: (text: string, source?: 'keyboard') => void
  }
  cleanup?: (text: string) => Effect.Effect<string, Error>
  connected: boolean
  transient?: boolean
}) {
  const service = useMobileDictation()
  const serviceRef = useRef(service)
  serviceRef.current = service
  const { profile, snapshot, readRuntime } = useRuntime()
  const preferences = useMobilePreferences()
  const runtimeId = snapshot?.runtimeId ?? profile?.connection.runtimeId
  const selected = !!(runtimeId && preferences.runtimeDictationIds.includes(runtimeId))
  const owns = service.owner?.key === draftKey
  const speech = (owns ? service.owner?.remote : selected) ? service.runtime : service.local
  const focused = useIsFocused()
  const location = useRef({ draftKey, focused })
  location.current = { draftKey, focused }
  const [state, setState] = useApplicationState<Cleanup | null>(null)
  const latest = useRef({
    draft,
    cleanup,
    connected,
  })
  latest.current = {
    draft,
    cleanup,
    connected,
  }
  const currentText = useRef(draft.text)
  currentText.current = draft.text
  const edit = useRef<DictationDraftEdit | null>(null)
  const mounted = useRef(true)
  const write = (text: string) => {
    currentText.current = text
    latest.current.draft.update(text)
  }
  const reset = () => {
    edit.current?.invalidate()
    edit.current = null
    setState(null)
  }
  const clean = (transaction: DictationDraftEdit, transcript: string, raw: string) => {
    const cleanup = latest.current.cleanup
    if (!cleanup) return
    return runClientEffect(
      mobileWorkflow(function* () {
        if (!latest.current.connected) {
          setState({
            status: 'failed',
            raw,
            transcript,
            error: 'Connect your computer to clean up the transcript.',
          })
          return
        }
        setState({
          status: 'cleaning',
          raw,
          transcript,
        })
        return yield* mobileWorkflow(function* () {
          const cleaned = yield* cleanup(transcript)
          if (!mounted.current || edit.current !== transaction) return
          const next = transaction.clean(currentText.current, cleaned)
          if (next === null) return
          write(next)
          setState(
            next === raw
              ? null
              : {
                  status: 'done',
                  raw,
                  transcript,
                  cleaned: next,
                },
          )
        }).pipe(
          Effect.catch((error) =>
            nativeEffect(() => {
              // Speech is already saved locally; a model/network failure must never lose it.
              if (mounted.current && edit.current === transaction)
                setState({
                  status: 'failed',
                  raw,
                  transcript,
                  error: error instanceof Error ? error.message : String(error),
                })
            }),
          ),
        )
      }),
    )
  }
  const speechRef = useRef(speech)
  speechRef.current = { ...speech, clearError: owns ? speech.clearError : () => {} }
  const update = useCallback(
    (text: string, source?: 'keyboard') => {
      edit.current?.invalidate()
      edit.current = null
      setState(null)
      speechRef.current.clearError()
      currentText.current = text
      latest.current.draft.update(text, source)
    },
    [setState],
  )
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!transient) return
    return () => {
      void serviceRef.current.cancel(draftKey)
    }
  }, [draftKey, transient])
  return {
    ...speech,
    available: speech.available && (!service.busy || owns),
    error: owns ? speech.error : null,
    permissionDenied: owns && speech.permissionDenied,
    isRecording: owns && speech.isRecording,
    isStarting: owns && speech.isStarting,
    isStopping: owns && speech.isStopping,
    stop: () => {
      if (owns) void speech.stop()
    },
    cancel: () => {
      if (owns) void speech.cancel()
    },
    state,
    active: owns && service.busy,
    start: async (selection?: DraftSelection) => {
      if (service.busy) return
      reset()
      const initial = currentText.current
      const transaction = new DictationDraftEdit(initial, selection)
      const originalDraft = latest.current.draft
      edit.current = transaction
      let expected = initial
      const visible = () =>
        mounted.current && location.current.focused && location.current.draftKey === draftKey
      Keyboard.dismiss()
      await service.start(
        draftKey,
        title,
        selected
          ? {
              taskId,
              ready: connected && !!snapshot?.runtimeDictationSupported && !!profile,
              language: preferences.dictationLanguage,
              call: (path, input, schema, method, options) => {
                if (!profile) return Promise.reject(new Error('This computer is no longer paired.'))
                return readRuntime(profile, path, input, schema, method, options)
              },
            }
          : undefined,
        {
          onResult: (transcript) => {
            if (!visible() || edit.current !== transaction) return
            expected = transaction.preview(transcript)
            write(expected)
          },
          onFinish: (transcript) => {
            if (!transcript.trim() || edit.current !== transaction) return
            const raw = transaction.preview(transcript)
            if (visible()) {
              write(raw)
              void clean(transaction, transcript, raw)
            } else if (transient) {
              return
            } else if (editing) {
              // The originating queue edit verifies its saved session before applying changes.
              originalDraft.update(raw)
            } else {
              void runClientEffect(
                drafts.finishDictationEffect(draftKey, initial, expected, raw, transcript.trim()),
              ).catch((error: unknown) => Alert.alert('Could not save dictation', String(error)))
            }
          },
        },
      )
    },
    update,
    reset,
    keepOriginal: () => {
      if (state?.status === 'done' && currentText.current === state.cleaned) write(state.raw)
      reset()
    },
    retry: () => {
      if (state?.status === 'failed' && edit.current && currentText.current === state.raw)
        void clean(edit.current, state.transcript, state.raw)
    },
  }
}
