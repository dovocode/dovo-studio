import type { RefObject } from 'react'
import { Pilcrow } from 'lucide-react'
import { readAppPreferences, updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { IconButton } from '@dovo/studio-ui'
import { composerSelection } from './composer-input'

/** The rich editor loads on demand, so Markdown source users never download it. */
export const loadRichComposer = () => import('./rich-composer-editor')
if (readAppPreferences().richTextComposer) void loadRichComposer()

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const composerModeShortcut = `${mac ? '⌘' : 'Ctrl'}+Shift+M`

type ModeCaret = { start: number; end: number; focused: boolean }
const carets = new WeakMap<object, ModeCaret>()

/**
 * Switch between rich text and Markdown source. The draft is unchanged; focus and the caret
 * move to the same place in the other editor.
 */
export async function toggleComposerMode(input: RefObject<HTMLElement | null>) {
  const element = input.current
  const caret = {
    ...composerSelection(element, 0),
    focused: !!element && document.activeElement === element,
  }
  const rich = !readAppPreferences().richTextComposer
  if (rich) await loadRichComposer()
  carets.set(input, caret)
  updateAppPreferences({ richTextComposer: rich })
}

/** Carry focus and the caret into the other editor when the composer switches by itself. */
export function rememberModeCaret(input: RefObject<HTMLElement | null>, caret: ModeCaret) {
  carets.set(input, caret)
}

/** The caret recorded by the last switch of this composer, once. */
export function takeModeCaret(input: RefObject<HTMLElement | null>) {
  const caret = carets.get(input)
  carets.delete(input)
  return caret
}

export function ComposerModeToggle({
  input,
  disabled,
}: {
  input: RefObject<HTMLElement | null>
  disabled?: boolean
}) {
  const { richTextComposer } = useAppPreferences()
  return (
    <IconButton
      type="button"
      label={`Markdown source (${composerModeShortcut})`}
      aria-keyshortcuts={mac ? 'Meta+Shift+M' : 'Control+Shift+M'}
      aria-pressed={!richTextComposer}
      className="composer-mode-toggle size-8"
      disabled={disabled}
      // Keep a focused editor focused; the switch restores its caret in the other mode.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => void toggleComposerMode(input)}
    >
      <Pilcrow className="size-4" />
    </IconButton>
  )
}
