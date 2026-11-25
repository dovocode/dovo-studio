import type { RtfSpan } from '@dovo/protocol'
import { HttpError } from '../../errors.js'

// Adapted from T3 Code's extendedDocumentPreview.ts (MIT, docs/licenses/t3-code-MIT.txt).
// Characters RTF writes as control symbols (`\~`) and control words (`\emspace`).
const RTF_CHARACTERS = new Map([
  ['~', '\u00a0'],
  ['_', '\u2011'],
  ['-', '\u00ad'],
  ['tab', '\t'],
  ['endash', '–'],
  ['emdash', '—'],
  ['bullet', '•'],
  ['lquote', '‘'],
  ['rquote', '’'],
  ['ldblquote', '“'],
  ['rdblquote', '”'],
  ['enspace', '\u2002'],
  ['emspace', '\u2003'],
  ['qmspace', '\u2005'],
  ['zwbo', '\u200b'],
  ['zwnj', '\u200c'],
  ['zwj', '\u200d'],
  ['ltrmark', '\u200e'],
  ['rtlmark', '\u200f'],
])

const rtfCodePageLabel = (codePage: number) =>
  (
    {
      0: 'windows-1252',
      866: 'ibm866',
      65001: 'utf-8',
      932: 'shift_jis',
      936: 'gbk',
      949: 'euc-kr',
      950: 'big5',
      874: 'windows-874',
      10000: 'macintosh',
    } as Record<number, string>
  )[codePage] ?? `windows-${codePage}`

export const MAX_RTF_BYTES = 8 * 1024 * 1024

export function parseRtf(bytes: Buffer): RtfSpan[][] {
  // Preserve byte offsets for control words and binary destinations.
  const source = bytes.toString('latin1')
  if (!source.startsWith('{\\rtf'))
    throw new HttpError(422, 'This file does not contain an RTF document.')
  let state = {
    skip: false,
    deleted: false,
    hiddenText: false,
    bold: false,
    italic: false,
    underline: false,
    uc: 1,
    font: 0,
    fontTable: false,
    fontFile: false,
    decoder: new TextDecoder('windows-1252'),
  }
  // A font's \cpg, else its \fcharset, encodes the bytes written in that font. A \cpg inside
  // \fontfile encodes the font's file name instead.
  const fonts = new Map<number, TextDecoder>()
  let defaultFont = 0
  const stack: (typeof state)[] = []
  let page: RtfSpan[] = []
  const pages: RtfSpan[][] = []
  let characters = 0
  let spans = 0
  const finishPage = () => {
    if (pages.length >= 500) throw new HttpError(413, 'RTF previews support up to 500 pages.')
    pages.push(page)
    page = []
  }
  let run = ''
  let fallback = 0
  const hidden = () => state.skip || state.deleted || state.hiddenText
  const encoded = new Uint8Array(bytes.byteLength)
  let encodedLength = 0
  const decodeBytes = () => {
    if (!encodedLength) return
    run += (fonts.get(state.font) ?? state.decoder).decode(encoded.subarray(0, encodedLength))
    encodedLength = 0
  }
  const append = (text: string, formatted = false) => {
    characters += text.length
    const bold = formatted && state.bold ? true : undefined
    const italic = formatted && state.italic ? true : undefined
    const underline = formatted && state.underline ? true : undefined
    const last = page.at(-1)
    if (last && last.bold === bold && last.italic === italic && last.underline === underline) {
      last.text += text
    } else {
      spans++
      page.push({ text, bold, italic, underline })
    }
    if (characters > 1024 * 1024 || spans > 12000)
      throw new HttpError(413, 'This RTF document has too much text or formatting to preview.')
  }
  const flush = () => {
    decodeBytes()
    if (!run) return
    append(run, true)
    run = ''
  }
  const emit = (value: string, skip = hidden()) => {
    if (fallback > 0) {
      fallback--
      return
    }
    if (skip) return
    decodeBytes()
    run += value
  }
  const emitByte = (value: number) => {
    if (fallback > 0) fallback--
    else if (!hidden()) encoded[encodedLength++] = value
  }
  const controlWord = /([a-z]+)(-?\d+)? ?/iy
  for (let i = 0; i < source.length;) {
    const char = source[i++]
    if (char === '{') {
      flush()
      fallback = 0
      if (stack.length > 100) throw new HttpError(422, 'This RTF document is nested too deeply.')
      stack.push({ ...state })
    } else if (char === '}') {
      flush()
      fallback = 0
      const parent = stack.pop()
      if (!parent) throw new HttpError(422, 'This RTF document is malformed.')
      state = parent
      if (stack.length === 0) break
    } else if (char === '\\') {
      const next = source[i]
      if (next === "'") {
        const hex = source.slice(i + 1, i + 3)
        if (!/^[\da-f]{2}$/i.test(hex))
          throw new HttpError(422, 'This RTF document has an invalid byte escape.')
        i += 3
        emitByte(Number.parseInt(hex, 16))
        continue
      }
      // \u, \uc and skipped fallbacks change no formatting, so a character written as two \u
      // words stays in one run.
      if (fallback === 0 && !/^uc?-?\d/.test(source.slice(i, i + 4))) flush()
      if (next === '\\' || next === '{' || next === '}') {
        i++
        emit(next)
        continue
      }
      if (next === '*') {
        state.skip = true
        i++
        continue
      }
      controlWord.lastIndex = i
      const match = controlWord.exec(source)
      if (!match) {
        const character = RTF_CHARACTERS.get(next!)
        if (character) emit(character)
        // A backslash before a line break is \par; TextEdit ends paragraphs this way.
        else if (next === '\n' || next === '\r') {
          if (fallback > 0) fallback--
          else if (!hidden()) append('\n')
        }
        i++
        continue
      }
      i += match[0].length
      const word = match[1]
      const arg = match[2] === undefined ? 1 : Number(match[2])
      if (word === 'bin') {
        if (!Number.isSafeInteger(arg) || arg < 0 || arg > source.length - i)
          throw new HttpError(422, 'This RTF document has invalid binary data.')
        i += arg
      }
      if (fallback > 0) {
        fallback--
        continue
      }
      if (word === 'fonttbl') {
        state.fontTable = true
        state.skip = true
      } else if (word === 'deff') state.font = defaultFont = arg
      else if (word === 'f') state.font = arg
      else if (word === 'fcharset' && state.fontTable) {
        const label = (
          {
            0: 'windows-1252',
            1: state.decoder.encoding,
            77: 'macintosh',
            128: 'shift_jis',
            129: 'euc-kr',
            134: 'gbk',
            136: 'big5',
            161: 'windows-1253',
            162: 'windows-1254',
            163: 'windows-1258',
            177: 'windows-1255',
            178: 'windows-1256',
            186: 'windows-1257',
            204: 'windows-1251',
            222: 'windows-874',
            238: 'windows-1250',
            255: 'ibm866',
          } as Record<number, string>
        )[arg]
        if (label) fonts.set(state.font, new TextDecoder(label))
      } else if (word === 'fontfile') state.fontFile = true
      else if (word === 'cpg' && state.fontTable && !state.fontFile) {
        try {
          fonts.set(state.font, new TextDecoder(rtfCodePageLabel(arg)))
        } catch {
          // An unknown font code page leaves the font on its \fcharset.
        }
      } else if (
        [
          'colortbl',
          'stylesheet',
          'info',
          'pict',
          'object',
          'fldinst',
          'header',
          'headerl',
          'headerr',
          'headerf',
          'footer',
          'footerl',
          'footerr',
          'footerf',
          'filetbl',
          'datastore',
          'themedata',
        ].includes(word!)
      )
        state.skip = true
      else if (word === 'mac') state.decoder = new TextDecoder('macintosh')
      else if (word === 'ansicpg') {
        try {
          state.decoder = new TextDecoder(rtfCodePageLabel(arg))
        } catch {
          throw new HttpError(422, 'This RTF document uses an unsupported text encoding.')
        }
      } else if (word === 'b') state.bold = arg !== 0
      else if (word === 'i') state.italic = arg !== 0
      else if (word === 'ul') state.underline = arg !== 0
      else if (word === 'ulnone') state.underline = false
      else if (word === 'deleted') state.deleted = arg !== 0
      else if (word === 'v') state.hiddenText = arg !== 0
      else if (word === 'plain')
        state = {
          ...state,
          deleted: false,
          hiddenText: false,
          bold: false,
          italic: false,
          underline: false,
          font: defaultFont,
        }
      else if (word === 'uc') state.uc = Math.max(0, Math.min(10, arg))
      else if (word === 'u') {
        fallback = 0
        // TextEdit writes a soft line break as U+2028, where Chromium does not break the line.
        if (arg !== 0x2028) emit(String.fromCharCode(arg < 0 ? arg + 65536 : arg))
        else if (!hidden()) {
          flush()
          append('\n')
        }
        fallback = state.uc
      } else if (!hidden() && word === 'page') finishPage()
      else if (word === 'cell') emit('\t', state.skip)
      else if (
        (!state.skip && word === 'row') ||
        (!hidden() && (word === 'par' || word === 'line'))
      )
        append('\n')
      // Writers usually end the paragraph before these breaks; a second break would add a blank line.
      else if (!hidden() && (word === 'sect' || word === 'column')) {
        if (page.length && !page.at(-1)?.text.endsWith('\n')) append('\n')
      } else {
        const character = RTF_CHARACTERS.get(word!)
        if (character) emit(character)
      }
    } else if (char !== '\r' && char !== '\n' && char) emitByte(char.charCodeAt(0))
  }
  if (stack.length) throw new HttpError(422, 'This RTF document is malformed.')
  flush()
  if (page.length || !pages.length) finishPage()
  return pages
}
