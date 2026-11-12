import { useLayoutEffect, useRef, type RefObject } from 'react'
import {
  baseKeymap,
  chainCommands,
  lift,
  liftEmptyBlock,
  newlineInCode,
  setBlockType,
  toggleMark,
  wrapIn,
} from 'prosemirror-commands'
import { history, redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { Fragment, Slice, type MarkType, type Node } from 'prosemirror-model'
import { EditorState, Plugin, Selection, TextSelection, type Command } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { cn } from '@dovo/studio-ui'
import type { ComposerReferenceResources } from '@dovo/protocol'
import { contextReferences, expandReferences, referenceNodeView } from './composer-references'
import { registerComposerInput } from './composer-input'
import {
  parseRichMarkdown,
  positionAtSourceOffset,
  rememberRichMarkdown,
  richSchema,
  serializeRichMarkdown,
  sourceOffsetAt,
  type RichMarkdown,
} from './rich-markdown'

/** Mention menus work on the text before the caret in the current block. */
export type RichComposerHandle = {
  mentionContext(): { text: string; caret: number } | null
  /** Replace `start..caret` of the mention context. Markdown text keeps its formatting. */
  replaceBeforeCaret(start: number, caret: number, text: string, markdown?: boolean): void
}

export type RichKeyContext = { atStart: boolean; collapsed: boolean }

export type RichComposerEditorProps = {
  value: string
  resources: ComposerReferenceResources
  onChange: (text: string) => void
  input: RefObject<HTMLElement | null>
  handle: RefObject<RichComposerHandle | null>
  /** Runs before the editor's own keys, including mode switching; prevent default to claim. */
  onKeyDown: (event: KeyboardEvent, context: RichKeyContext) => void
  onSelectionChange: () => void
  /** The editor element is now the composer input. */
  onMount?: () => void
  sendWith: 'enter' | 'mod-enter'
  readOnly: boolean
  disabled: boolean
  hidden: boolean
  autoFocus: boolean
  placeholder: string
  attributes: Record<string, string | undefined>
}

const { nodes, marks } = richSchema
const external = 'dovoExternalValue'

const breakOrParagraph: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false
  // A second line break starts a new paragraph, as a blank line does in Markdown.
  if (empty && $from.nodeBefore?.type === nodes.hard_break) {
    if (dispatch) {
      const tr = state.tr.delete($from.pos - 1, $from.pos)
      dispatch(tr.split(tr.mapping.map($from.pos)).scrollIntoView())
    }
    return true
  }
  dispatch?.(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView())
  return true
}
const splitListItem: Command = (state, dispatch) => {
  const { $from, $to } = state.selection
  if ($from.depth < 2 || $from.node(-1).type !== nodes.list_item || !$from.sameParent($to))
    return false
  if (!$from.parent.content.size) return liftEmptyBlock(state, dispatch)
  if (dispatch) dispatch(state.tr.delete($from.pos, $to.pos).split($from.pos, 2).scrollIntoView())
  return true
}
const newline = chainCommands(newlineInCode, splitListItem, breakOrParagraph)
// Backspace at the start of a heading, quote or list item turns it back into a paragraph.
const unwrapAtStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || $from.parentOffset > 0) return false
  if ($from.parent.type !== nodes.paragraph) return setBlockType(nodes.paragraph)(state, dispatch)
  return $from.depth > 1 && $from.node(-1).type !== nodes.list_item ? lift(state, dispatch) : false
}
const markKeys = (type: MarkType) => toggleMark(type)
const editingKeys = keymap({
  'Mod-z': undo,
  'Shift-Mod-z': redo,
  'Mod-y': redo,
  'Mod-b': markKeys(marks.strong),
  'Mod-i': markKeys(marks.em),
  'Mod-e': markKeys(marks.code),
  'Mod-Shift-x': markKeys(marks.strike),
  Backspace: unwrapAtStart,
})

const blockShortcuts: [RegExp, (match: RegExpExecArray) => Command][] = [
  [/^(#{1,6})$/, (match) => setBlockType(nodes.heading, { level: match[1].length })],
  [/^[-*+]$/, () => wrapIn(nodes.bullet_list)],
  [/^(\d{1,9})[.)]$/, (match) => wrapIn(nodes.ordered_list, { order: Number(match[1]) })],
  [/^>$/, () => wrapIn(nodes.blockquote)],
  [/^```([\w-]*)$/, (match) => setBlockType(nodes.code_block, { params: match[1] })],
]
const inlineShortcuts: [RegExp, MarkType][] = [
  [/(?:^|[\s(])(`([^`]+)`)$/, marks.code],
  [/(?:^|[\s(])(\*\*([^*\s](?:[^*]*[^*\s])?)\*\*)$/, marks.strong],
  [/(?:^|[\s(])(~~([^~\s](?:[^~]*[^~\s])?)~~)$/, marks.strike],
  [/(?:^|[\s(])(\*([^*\s](?:[^*]*[^*\s])?)\*)$/, marks.em],
]

/** Markdown typing shortcuts: block markers followed by a space and closed inline spans. */
function markdownShortcut(view: EditorView, from: number, to: number, text: string) {
  const { state } = view
  const $from = state.doc.resolve(from)
  if ($from.parent.type.spec.code || from !== to) return false
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
  // Browsers report a space typed at the end of a block as a non-breaking space.
  if ((text === ' ' || text === '\u00a0') && $from.parent.type === nodes.paragraph) {
    for (const [pattern, command] of blockShortcuts) {
      const match = pattern.exec(before)
      if (!match) continue
      const start = from - before.length
      view.dispatch(state.tr.delete(start, from))
      if (!command(match)(view.state, view.dispatch))
        view.dispatch(view.state.tr.insertText(`${before} `, start))
      return true
    }
  }
  for (const [pattern, type] of inlineShortcuts) {
    const match = pattern.exec(before + text)
    if (!match) continue
    const start = from - (match[1].length - text.length)
    if (
      $from.parent.rangeHasMark(
        $from.parentOffset - (match[1].length - text.length),
        $from.parentOffset,
        marks.code,
      )
    )
      return false
    const tr = state.tr.replaceWith(start, to, richSchema.text(match[2], [type.create()]))
    view.dispatch(tr.removeStoredMark(type))
    return true
  }
  return false
}

/** Plain text pastes literally: single newlines are line breaks, blank lines split paragraphs. */
function plainTextSlice(text: string) {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((chunk) =>
      nodes.paragraph.create(
        null,
        chunk
          .split('\n')
          .flatMap((line, index) => [
            ...(index ? [nodes.hard_break.create()] : []),
            ...(line ? [richSchema.text(line)] : []),
          ]),
      ),
    )
  return new Slice(Fragment.from(paragraphs), 1, 1)
}

const isEmpty = (doc: Node) =>
  doc.childCount === 1 && doc.firstChild!.isTextblock && !doc.firstChild!.content.size

/** A ProseMirror editor over the Markdown draft. The draft stays the source of truth. */
export default function RichComposerEditor(props: RichComposerEditorProps) {
  const mount = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef(props)
  const current = useRef<RichMarkdown | null>(null)
  useLayoutEffect(() => {
    latest.current = props
  })
  useLayoutEffect(() => {
    const parsed = parseRichMarkdown(latest.current.value)
    const initial = parsed.supported
      ? parsed.value
      : (parseRichMarkdown('') as { supported: true; value: RichMarkdown }).value
    current.current = initial
    const readOnly = new Plugin({
      filterTransaction: (tr) =>
        !tr.docChanged || !!tr.getMeta(external) || !latest.current.readOnly,
    })
    const editor: EditorView = new EditorView(mount.current, {
      state: EditorState.create({
        doc: initial.doc,
        plugins: [
          history(),
          readOnly,
          contextReferences(() => latest.current.resources),
          editingKeys,
          keymap(baseKeymap),
        ],
      }),
      nodeViews: { context_reference: referenceNodeView },
      editable: () => !latest.current.disabled,
      attributes: () => {
        const { attributes, placeholder, disabled, readOnly } = latest.current
        const values: Record<string, string> = {
          role: 'textbox',
          'aria-multiline': 'true',
          'data-placeholder': placeholder,
          class: 'dovo-rich-composer',
          // Without pre-wrap, browsers type non-breaking spaces into the draft.
          style: 'white-space: pre-wrap; outline: none',
        }
        for (const [name, value] of Object.entries(attributes)) if (value) values[name] = value
        if (disabled) values['aria-disabled'] = 'true'
        if (readOnly) values['aria-readonly'] = 'true'
        if (view.current && isEmpty(view.current.state.doc)) values['data-empty'] = ''
        else if (!view.current && isEmpty(initial.doc)) values['data-empty'] = ''
        return values
      },
      dispatchTransaction(tr) {
        const next = editor.state.applyTransaction(tr).state
        editor.updateState(next)
        if (tr.docChanged && !tr.getMeta(external) && current.current) {
          const before = current.current.text
          current.current = serializeRichMarkdown(
            expandReferences(next.doc, current.current.doc),
            current.current,
          )
          rememberRichMarkdown(current.current)
          if (current.current.text !== before) latest.current.onChange(current.current.text)
        }
        if (tr.docChanged || tr.selectionSet) latest.current.onSelectionChange()
      },
      handleKeyDown(editorView, event) {
        if (event.isComposing || event.keyCode === 229) return false
        const mod = event.metaKey || event.ctrlKey
        const { selection, doc } = editorView.state
        latest.current.onKeyDown(event, {
          atStart: selection.from === Selection.atStart(doc).from,
          collapsed: selection.empty,
        })
        if (event.defaultPrevented) return true
        if (event.key !== 'Enter' || event.altKey) return false
        const send = latest.current.sendWith === 'enter' ? !event.shiftKey && !mod : mod
        if (!send) return newline(editorView.state, editorView.dispatch)
        event.preventDefault()
        if (latest.current.readOnly) return true
        const form = editorView.dom.closest('form')
        if (!form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled)
          form?.requestSubmit()
        return true
      },
      handleTextInput: markdownShortcut,
      // Files are attachments: the composer form uploads them instead of pasting text.
      handlePaste(_, event) {
        const data = event.clipboardData
        const files = Array.from(data?.files ?? [])
        return (
          !!files.length &&
          (!data?.getData('text/plain') || files.some((file) => file.type.startsWith('image/')))
        )
      },
      handleDrop: (_, event) => !!(event as DragEvent).dataTransfer?.files.length,
      clipboardTextParser: (text, $context) =>
        $context.parent.type.spec.code ? (null as unknown as Slice) : plainTextSlice(text),
      clipboardTextSerializer: (slice) => {
        const content = expandReferences(nodes.doc.create(null, slice.content)).content
        const doc = nodes.doc.create(
          null,
          content.firstChild?.isInline ? nodes.paragraph.create(null, content) : content,
        )
        const empty = parseRichMarkdown('')
        return empty.supported ? serializeRichMarkdown(doc, empty.value).text : ''
      },
    })
    view.current = editor
    editor.dispatch(
      editor.state.tr
        .replaceWith(0, editor.state.doc.content.size, initial.doc.content)
        .setMeta(external, true)
        .setMeta('addToHistory', false),
    )
    const input = latest.current.input
    input.current = editor.dom
    const unregister = registerComposerInput(editor.dom, {
      selection() {
        const { from, to } = editor.state.selection
        const text = current.current?.text ?? ''
        return {
          start: sourceOffsetAt(editor.state.doc, text, from),
          end: sourceOffsetAt(editor.state.doc, text, to),
        }
      },
      select(start, end) {
        const { doc } = editor.state
        const text = current.current?.text ?? ''
        const selection = TextSelection.between(
          doc.resolve(positionAtSourceOffset(doc, text, start)),
          doc.resolve(positionAtSourceOffset(doc, text, end)),
        )
        editor.dispatch(editor.state.tr.setSelection(selection).scrollIntoView())
      },
    })
    const handle = latest.current.handle
    handle.current = {
      mentionContext() {
        const { $from, empty } = editor.state.selection
        if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return null
        const text = $from.parent.textBetween(0, $from.parentOffset, undefined, '\n')
        return { text, caret: text.length }
      },
      replaceBeforeCaret(start, caret, text, markdown) {
        const { from } = editor.state.selection
        const begin = from - (caret - start)
        const parsed = markdown && text.trim() ? parseRichMarkdown(text) : null
        const tr = parsed?.supported
          ? editor.state.tr.replaceRange(begin, from, new Slice(parsed.value.doc.content, 1, 1))
          : editor.state.tr.replaceRange(begin, from, plainTextSlice(text))
        editor.dispatch(tr.scrollIntoView())
        editor.focus()
      },
    }
    if (latest.current.autoFocus) editor.focus()
    latest.current.onMount?.()
    return () => {
      unregister()
      if (handle.current) handle.current = null
      if (input.current === editor.dom) input.current = null
      view.current = null
      editor.destroy()
    }
  }, [])
  // External changes: history recall, dictation, inserts, accepted sends and other devices.
  useLayoutEffect(() => {
    const editor = view.current
    if (!editor || props.value === current.current?.text) return
    const parsed = parseRichMarkdown(props.value)
    if (!parsed.supported) return
    const focused = editor.hasFocus()
    const tr = editor.state.tr
      .replaceWith(0, editor.state.doc.content.size, parsed.value.doc.content)
      .setMeta(external, true)
      .setMeta('addToHistory', false)
    tr.setSelection(Selection.atEnd(tr.doc))
    editor.dispatch(tr)
    // Keep exact source for the replaced blocks so the next edit rewrites only what changes.
    const blocks: Node[] = []
    expandReferences(editor.state.doc, parsed.value.doc).forEach((block) => blocks.push(block))
    current.current =
      blocks.length === parsed.value.blocks.length &&
      blocks.every((block, index) => block.eq(parsed.value.blocks[index]))
        ? { ...parsed.value, blocks }
        : { ...parsed.value, blocks: [], pieces: [], separators: [] }
    if (focused) editor.focus()
  }, [props.value])
  // Attributes and editability follow props without recreating the editor.
  useLayoutEffect(() => {
    view.current?.setProps({})
  }, [props.disabled, props.readOnly, props.placeholder, props.attributes, props.value])
  return (
    <div
      ref={mount}
      data-composer-input=""
      // The host is taller than one line; clicking its empty space edits at the end.
      onMouseDown={(event) => {
        const editor = view.current
        if (event.target !== event.currentTarget || !editor || props.disabled) return
        event.preventDefault()
        editor.focus()
        editor.dispatch(editor.state.tr.setSelection(Selection.atEnd(editor.state.doc)))
      }}
      className={cn(
        'dovo-rich-composer-host min-h-24 max-h-64 overflow-y-auto px-4 pt-4 pb-2 text-[0.8125rem]',
        props.hidden && 'hidden',
      )}
    />
  )
}
