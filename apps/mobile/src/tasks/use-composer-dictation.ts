import { useEffect, useRef, useState } from 'react'
import { Keyboard } from 'react-native'
import { useDictation } from './use-dictation'
import { DictationDraftEdit, type DraftSelection } from './dictation-draft'

type Cleanup = {
  status: 'cleaning' | 'failed' | 'done'
  raw: string
  transcript: string
  cleaned?: string
  error?: string
}

export function useComposerDictation({
  draft,
  cleanup,
  connected,
}: {
  draft: { text: string; update: (text: string) => void }
  cleanup: (text: string) => Promise<string>
  connected: boolean
}) {
  const [state, setState] = useState<Cleanup | null>(null)
  const latest = useRef({ draft, cleanup, connected })
  latest.current = { draft, cleanup, connected }
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
  const clean = async (transaction: DictationDraftEdit, transcript: string, raw: string) => {
    if (!latest.current.connected) {
      setState({
        status: 'failed',
        raw,
        transcript,
        error: 'Connect your computer to clean up the transcript.',
      })
      return
    }
    setState({ status: 'cleaning', raw, transcript })
    try {
      const cleaned = await latest.current.cleanup(transcript)
      if (!mounted.current || edit.current !== transaction) return
      const next = transaction.clean(currentText.current, cleaned)
      if (next === null) return
      write(next)
      setState(next === raw ? null : { status: 'done', raw, transcript, cleaned: next })
    } catch (error) {
      // Speech is already saved locally; a model/network failure must never lose it.
      if (mounted.current && edit.current === transaction)
        setState({
          status: 'failed',
          raw,
          transcript,
          error: error instanceof Error ? error.message : String(error),
        })
    }
  }
  const speech = useDictation({
    onResult: (transcript) => {
      if (edit.current) write(edit.current.preview(transcript))
    },
    onFinish: (transcript) => {
      const transaction = edit.current
      if (!transaction || !transcript.trim()) return
      const raw = transaction.preview(transcript)
      write(raw)
      void clean(transaction, transcript, raw)
    },
  })
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      edit.current?.invalidate()
      edit.current = null
    }
  }, [])
  return {
    ...speech,
    state,
    active: speech.isRecording || speech.isStarting || speech.isStopping,
    start: async (selection?: DraftSelection) => {
      reset()
      edit.current = new DictationDraftEdit(currentText.current, selection)
      Keyboard.dismiss()
      await speech.start()
    },
    update: (text: string) => {
      reset()
      speech.clearError()
      write(text)
    },
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
