import { app, type WebContents } from 'electron'
import { readLocalSettingsSection } from '@dovo/protocol/local-settings'
import { decodeResult, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'
const preference = mutableStruct({ quitShortcut: Schema.Literal('immediate', 'hold', 'disabled') })
/** Menu-based Quit remains available; this only changes the keyboard shortcut. */
export function registerQuitShortcut(contents: WebContents) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pressed = false
  let lastPress = 0
  const reset = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    pressed = false
  }
  contents.on('before-input-event', (event, input) => {
    const quitKey =
      input.key.toLowerCase() === 'q' &&
      (process.platform === 'darwin' ? input.meta : input.control) &&
      !input.alt &&
      !input.shift
    if (input.type === 'keyUp') {
      if (input.key.toLowerCase() === 'q' || !quitKey) reset()
      return
    }
    if (!quitKey) return
    const saved = decodeResult(preference, readLocalSettingsSection('app'))
    const mode = saved.success ? saved.data.quitShortcut : 'immediate'
    if (mode === 'immediate') return
    event.preventDefault()
    if (mode === 'disabled' || pressed) return
    pressed = true
    const now = Date.now()
    if (lastPress && now - lastPress <= 500) {
      reset()
      app.quit()
      return
    }
    lastPress = now
    timer = setTimeout(() => {
      timer = undefined
      app.quit()
    }, 600)
  })
  contents.on('blur', reset)
  contents.once('destroyed', reset)
}
