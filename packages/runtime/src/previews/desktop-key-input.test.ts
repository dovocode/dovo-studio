import { expect, it } from 'vite-plus/test'
import { desktopKeyInput } from './desktop-browser.js'

it('maps editing chords without inserting their letters', () => {
  expect(desktopKeyInput('Control+a')).toMatchObject({ key: 'a', code: 'KeyA', modifiers: 2 })
  expect(desktopKeyInput('Meta+Shift+z')).toMatchObject({ code: 'KeyZ', modifiers: 12 })
  expect(desktopKeyInput('Control++')).toMatchObject({ code: 'Equal', modifiers: 10 })
  expect(desktopKeyInput('Enter')).toMatchObject({ key: 'Enter', code: 'Enter' })
  expect(desktopKeyInput('é')).toEqual({ text: 'é' })
  expect(() => desktopKeyInput('Control+Unknown')).toThrow('do not support')
})
