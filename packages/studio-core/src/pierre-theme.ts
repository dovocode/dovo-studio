import type { Theme, ThemeSyntaxSettings } from '@pierre/highlights'
import type { resolveCodeTheme } from './code-themes'

type SourceTheme = ReturnType<typeof resolveCodeTheme>
// Representative TextMate scopes for Pierre's lexical categories. Context selectors,
// exclusions and semantic-token rules have no exact equivalent in a lexical palette.
const scopes: Record<string, readonly string[]> = {
  comment: ['comment'],
  'comment.doc': ['comment.block.documentation'],
  string: [
    'string',
    'string.quoted',
    'string.quoted.single',
    'string.quoted.double',
    'string.template',
  ],
  'string.escape': ['constant.character.escape'],
  'string.regex': ['string.regexp'],
  'string.special': ['constant.other.symbol'],
  'string.special.symbol': ['constant.other.symbol'],
  number: ['constant.numeric'],
  boolean: ['constant.language.boolean', 'constant.language'],
  constant: ['constant', 'variable.other.constant'],
  keyword: ['keyword', 'keyword.control', 'storage', 'storage.type', 'storage.modifier'],
  'keyword.operator': ['keyword.operator'],
  'keyword.directive': ['keyword.control.directive'],
  function: ['entity.name.function', 'support.function'],
  'function.call': ['entity.name.function', 'support.function'],
  'function.method': ['entity.name.function.member', 'support.function'],
  'function.builtin': ['support.function'],
  'function.special.definition': ['entity.name.function'],
  type: ['entity.name.type', 'entity.name.class', 'support.type'],
  'type.builtin': ['support.type', 'support.class'],
  constructor: ['entity.name.type', 'entity.name.class'],
  class: ['entity.name.class'],
  enum: ['entity.name.type.enum'],
  variant: ['variable.other.enummember'],
  variable: ['variable', 'variable.other'],
  'variable.member': ['variable.other.property'],
  'variable.parameter': ['variable.parameter'],
  'variable.builtin': ['variable.language'],
  'variable.special': ['variable.language'],
  'variable.language': ['variable.language'],
  property: ['variable.other.property', 'support.type.property-name', 'meta.object-literal.key'],
  'property.css': ['support.type.property-name.css'],
  'property.definition': ['support.type.property-name', 'meta.object-literal.key'],
  tag: ['entity.name.tag'],
  'tag.css': ['entity.name.tag.css'],
  attribute: ['entity.other.attribute-name'],
  'attribute.builtin': ['entity.other.attribute-name'],
  namespace: ['entity.name.namespace'],
  label: ['entity.name.label'],
  decorator: ['entity.name.function.decorator'],
  punctuation: ['punctuation'],
  'punctuation.bracket': ['punctuation.section', 'punctuation.definition'],
  'punctuation.delimiter': ['punctuation.separator', 'punctuation.terminator'],
  operator: ['keyword.operator'],
  'selector.class': ['entity.other.attribute-name.class.css'],
  'selector.id': ['entity.other.attribute-name.id.css'],
  'selector.pseudo': ['entity.other.attribute-name.pseudo-class.css'],
  unit: ['keyword.other.unit'],
  'number.unit': ['keyword.other.unit'],
  color: ['constant.other.color'],
  'markup.heading': ['markup.heading', 'entity.name.section'],
  'markup.bold': ['markup.bold'],
  'markup.italic': ['markup.italic'],
  'markup.link.url': ['markup.underline.link'],
  'markup.link.text': ['string.other.link.title'],
  'markup.quote': ['markup.quote'],
  'markup.list': ['markup.list'],
  'markup.raw': ['markup.raw'],
  'markup.raw.inline': ['markup.inline.raw', 'markup.raw.inline'],
  'markup.raw.block': ['markup.raw.block'],
  'diff.plus': ['markup.inserted'],
  'diff.minus': ['markup.deleted'],
  'diff.delta': ['markup.changed'],
}
const aliases: Record<string, string> = {
  property_name: 'property',
  class_name: 'selector.class',
  id_name: 'selector.id',
  tag_name: 'tag',
  pseudo_class_selector: 'selector.pseudo',
  pseudo_element_selector: 'selector.pseudo',
  at_keyword: 'keyword.directive',
  'keyword.control.at-rule': 'keyword.directive',
  'constant.css': 'constant',
  'string.plain': 'string',
  plain_value: 'string',
  'constant.color': 'color',
  this: 'variable.language',
  preproc: 'keyword.directive',
  'text.literal': 'string',
  link_text: 'markup.link.text',
  link_uri: 'markup.link.url',
  emphasis: 'markup.italic',
  'emphasis.strong': 'markup.bold',
  title: 'markup.heading',
}
const mapped = new WeakMap<SourceTheme, Theme>()

/** Convert built-in and imported VS Code colors to Pierre's Zed palette, once per definition. */
export function pierreTheme(source: SourceTheme): Theme {
  const previous = mapped.get(source)
  if (previous) return previous
  const rules = source.tokenColors.flatMap((rule, order) => {
    const selectors = (
      typeof rule.scope === 'string' ? [rule.scope] : (rule.scope ?? [''])
    ).flatMap((scope) => scope.split(','))
    return selectors
      .map((scope) => ({ scope: scope.trim(), settings: rule.settings, order }))
      .filter(({ scope }) => !scope || /^[\w-]+(?:\.[\w-]+)*$/.test(scope))
  })
  const syntax: Record<string, ThemeSyntaxSettings> = {}
  for (const [category, candidates] of Object.entries(scopes)) {
    const matches = rules
      .filter(
        ({ scope }) =>
          !scope ||
          candidates.some((candidate) => candidate === scope || candidate.startsWith(`${scope}.`)),
      )
      .sort(
        (a, b) =>
          (a.scope ? a.scope.split('.').length : 0) - (b.scope ? b.scope.split('.').length : 0) ||
          a.order - b.order,
      )
    const style: ThemeSyntaxSettings = { color: source.fg }
    for (const { settings } of matches) {
      if (settings.foreground) style.color = settings.foreground
      const fontStyle = 'fontStyle' in settings ? settings.fontStyle : undefined
      if (fontStyle !== undefined) {
        const flags = fontStyle.split(/\s+/)
        style.font_style = flags.includes('italic') ? 'italic' : 'normal'
        style.font_weight = flags.includes('bold') ? 700 : 400
      }
    }
    syntax[category] = style
  }
  for (const [alias, category] of Object.entries(aliases)) syntax[alias] = syntax[category]!
  const theme: Theme = {
    name: source.name,
    appearance: source.type,
    style: {
      ...source.colors,
      background: source.bg,
      text: source.fg,
      'editor.background': source.bg,
      'editor.foreground': source.fg,
      syntax,
    },
  }
  mapped.set(source, theme)
  return theme
}
