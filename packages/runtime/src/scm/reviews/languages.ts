import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import type { Language, Node } from 'web-tree-sitter'

const extensions = {
  javascript: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'],
  python: ['.py', '.pyi'],
  go: ['.go'],
  rust: ['.rs'],
  java: ['.java'],
  kotlin: ['.kt', '.kts'],
  swift: ['.swift'],
  c_sharp: ['.cs'],
  php: ['.php', '.phtml', '.inc'],
} as const
export type ReviewLanguage = keyof typeof extensions
export function reviewLanguage(path: string): ReviewLanguage | undefined {
  for (const language of [
    'javascript',
    'python',
    'go',
    'rust',
    'java',
    'kotlin',
    'swift',
    'c_sharp',
    'php',
  ] as const)
    if (extensions[language].some((suffix) => path.endsWith(suffix))) return language
  return undefined
}
export type SourceAnalysis = {
  language: ReviewLanguage
  imports: string[]
  namespace: string
  declarations: string[]
  references: string[]
  includes?: string[]
}
const require = createRequire(import.meta.url)
const cache = new Map<string, Promise<SourceAnalysis | null>>()
let engine: Promise<typeof import('web-tree-sitter')> | undefined
const grammars = new Map<ReviewLanguage, Promise<Language>>()
function grammar(language: ReviewLanguage) {
  let pending = grammars.get(language)
  if (!pending) {
    engine ??= import('web-tree-sitter').then(async (engine) => {
      await engine.Parser.init({
        locateFile: () => require.resolve('web-tree-sitter/tree-sitter.wasm'),
      })
      return engine
    })
    pending = engine.then(({ Language }) => {
      const filename = `tree-sitter-${language}.wasm`
      const packaged = new URL(`./grammars/${filename}`, import.meta.url)
      return Language.load(
        existsSync(packaged)
          ? fileURLToPath(packaged)
          : require.resolve(`tree-sitter-wasms/out/${filename}`),
      )
    })
    grammars.set(language, pending)
  }
  return pending
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object'
function javascript(source: string, path: string, result: SourceAnalysis) {
  const ast = parse(source, {
    sourceType: 'unambiguous',
    plugins: /\.(?:tsx|jsx|js)$/.test(path)
      ? ['typescript', 'jsx', 'decorators-legacy']
      : ['typescript', 'decorators-legacy'],
    allowReturnOutsideFunction: true,
  })
  const literal = (value: unknown) => {
    if (record(value) && value.type === 'StringLiteral' && typeof value.value === 'string')
      result.imports.push(value.value)
  }
  const pending: unknown[] = [ast.program]
  while (pending.length) {
    const node = pending.pop()
    if (Array.isArray(node)) {
      for (const child of node) pending.push(child)
      continue
    }
    if (!record(node)) continue
    if (
      [
        'ImportDeclaration',
        'ExportNamedDeclaration',
        'ExportAllDeclaration',
        'ImportExpression',
      ].includes(String(node.type))
    )
      literal(node.source)
    if (node.type === 'TSExternalModuleReference') literal(node.expression)
    if (node.type === 'TSImportType') literal(node.argument)
    if (
      node.type === 'CallExpression' &&
      record(node.callee) &&
      (node.callee.type === 'Import' ||
        (node.callee.type === 'Identifier' && node.callee.name === 'require')) &&
      Array.isArray(node.arguments)
    )
      literal(node.arguments[0])
    for (const [key, child] of Object.entries(node))
      if (!['loc', 'comments', 'tokens', 'errors'].includes(key)) pending.push(child)
  }
}
function rustUse(node: Node, prefix = ''): string[] {
  if (node.type === 'scoped_use_list') {
    const path = node.childForFieldName('path')?.text ?? ''
    return (node.childForFieldName('list')?.namedChildren ?? [])
      .filter((child): child is Node => child !== null)
      .flatMap((child) => rustUse(child, `${prefix}${path}::`))
  }
  if (node.type === 'use_as_clause') return [prefix + (node.childForFieldName('path')?.text ?? '')]
  if (node.type === 'use_wildcard') return [prefix + (node.namedChildren[0]?.text ?? '') + '::*']
  return [node.type === 'self' && prefix ? prefix.slice(0, -2) : prefix + node.text]
}
function phpInclude(node: Node): { suffix: string; anchored: boolean } | undefined {
  const children = node.namedChildren.filter((child): child is Node => child !== null)
  if (node.type === 'parenthesized_expression' && children[0]) return phpInclude(children[0])
  if (node.type === 'name' && node.text.toUpperCase() === '__DIR__')
    return { suffix: '', anchored: true }
  if (node.type === 'function_call_expression') {
    const name = node.childForFieldName('function')
    const argumentsNode = node.childForFieldName('arguments')
    const argumentsList = argumentsNode?.namedChildren.filter(
      (child): child is Node => child !== null,
    )
    const argument = argumentsList?.[0]?.namedChildren[0]
    if (
      name &&
      ['dirname', '\\dirname'].includes(name.text.toLowerCase()) &&
      argumentsList?.length === 1 &&
      argument?.type === 'name' &&
      argument.text.toUpperCase() === '__FILE__'
    )
      return { suffix: '', anchored: true }
  }
  if (
    ['string', 'encapsed_string'].includes(node.type) &&
    children.every((child) => child.type === 'string_value')
  )
    return { suffix: node.text.slice(1, -1), anchored: false }
  if (node.type === 'binary_expression' && node.children.some((child) => child?.type === '.')) {
    const leftNode = node.childForFieldName('left'),
      rightNode = node.childForFieldName('right')
    const left = leftNode && phpInclude(leftNode),
      right = rightNode && phpInclude(rightNode)
    if (left && right && !right.anchored)
      return { suffix: left.suffix + right.suffix, anchored: left.anchored }
  }
  return undefined
}
function php(root: Node, result: SourceAnalysis) {
  const namespaces = root.namedChildren.filter((node) => node?.type === 'namespace_definition')
  // Alias and declaration scopes cannot be combined across separate namespace blocks.
  if (namespaces.length > 1) return false
  result.namespace = namespaces[0]?.childForFieldName('name')?.text ?? ''
  const scope = namespaces[0]?.childForFieldName('body') ?? root
  const aliases = new Map<string, string>()
  const isName = (node: Node) => ['name', 'qualified_name', 'namespace_name'].includes(node.type)
  const qualified = (name: string) => name.replace(/^\\/, '')
  for (const declaration of scope.namedChildren) {
    if (declaration?.type !== 'namespace_use_declaration') continue
    // Function and constant imports have different lookup rules from class names.
    if (declaration.children.some((child) => ['function', 'const'].includes(child?.type ?? '')))
      continue
    const group = declaration.namedChildren.find((node) => node?.type === 'namespace_use_group')
    const prefix = group
      ? (declaration.namedChildren.find((node) => node?.type === 'namespace_name')?.text ?? '') +
        '\\'
      : ''
    for (const clause of group?.namedChildren ?? declaration.namedChildren) {
      if (
        !clause ||
        !['namespace_use_clause', 'namespace_use_group_clause'].includes(clause.type) ||
        clause.children.some((child) => ['function', 'const'].includes(child?.type ?? ''))
      )
        continue
      const name = clause.namedChildren.find((node) => node && isName(node))?.text
      if (!name) continue
      const target = qualified(prefix + name)
      const alias =
        clause.namedChildren.find((node) => node?.type === 'namespace_aliasing_clause')
          ?.namedChildren[0]?.text ??
        target.split('\\').at(-1) ??
        ''
      const key = alias.toLowerCase()
      if (aliases.has(key)) return false
      aliases.set(key, target)
      result.imports.push(target)
    }
  }
  const reference = (node: Node | null | undefined) => {
    if (!node || !isName(node)) return
    const name = node.text
    if (['self', 'parent', 'static'].includes(name.toLowerCase())) return
    const parts = name.split('\\')
    const alias = aliases.get((parts[0] ?? '').toLowerCase())
    result.references.push(
      name.startsWith('\\')
        ? qualified(name)
        : parts[0]?.toLowerCase() === 'namespace'
          ? [result.namespace, ...parts.slice(1)].filter(Boolean).join('\\')
          : alias
            ? [alias, ...parts.slice(1)].join('\\')
            : [result.namespace, name].filter(Boolean).join('\\'),
    )
  }
  result.includes = []
  const pending = [root]
  while (pending.length) {
    const node = pending.pop()!
    const children = node.namedChildren.filter((child): child is Node => child !== null)
    if (
      [
        'class_declaration',
        'interface_declaration',
        'trait_declaration',
        'enum_declaration',
      ].includes(node.type)
    ) {
      const name = node.childForFieldName('name')
      if (name) result.declarations.push(name.text)
    }
    if (
      ['named_type', 'base_clause', 'class_interface_clause', 'use_declaration'].includes(node.type)
    )
      for (const child of children) reference(child)
    if (['object_creation_expression', 'attribute'].includes(node.type))
      reference(children.find(isName))
    if (node.type === 'class_constant_access_expression') reference(children[0])
    if (['scoped_call_expression', 'scoped_property_access_expression'].includes(node.type))
      reference(node.childForFieldName('scope'))
    if (
      node.type === 'binary_expression' &&
      node.children.some((child) => child?.type === 'instanceof')
    )
      reference(node.childForFieldName('right'))
    if (
      [
        'require_expression',
        'require_once_expression',
        'include_expression',
        'include_once_expression',
      ].includes(node.type) &&
      children[0]
    ) {
      const included = phpInclude(children[0])
      if (included?.anchored && included.suffix.startsWith('/'))
        result.includes.push(included.suffix)
    }
    for (const child of children.reverse()) pending.push(child)
  }
  return true
}
/** Inspect grammar nodes, never source-text matches, for imports and declared/referenced types. */
function inspect(root: Node, result: SourceAnalysis) {
  const language = result.language
  if (language === 'php') return php(root, result)
  const pending = [root]
  while (pending.length) {
    const node = pending.pop()!
    const children = node.namedChildren.filter((child): child is Node => child !== null)
    const field = (name: string) => node.childForFieldName(name)
    if (language === 'python') {
      if (node.type === 'import_statement')
        for (const child of children)
          result.imports.push(
            (child.type === 'aliased_import' ? child.childForFieldName('name') : child)?.text ?? '',
          )
      if (node.type === 'import_from_statement') {
        const module = field('module_name')?.text ?? ''
        result.imports.push(module)
        for (const child of children.filter((child) => child.id !== field('module_name')?.id)) {
          const name = (child.type === 'aliased_import' ? child.childForFieldName('name') : child)
            ?.text
          if (name && name !== '*')
            result.imports.push(module + (module.endsWith('.') ? '' : '.') + name)
        }
      }
    } else if (language === 'go') {
      if (node.type === 'package_clause') result.namespace = children[0]?.text ?? ''
      if (node.type === 'import_spec') {
        const text = field('path')?.text ?? ''
        result.imports.push(text.slice(1, -1))
      }
      if (node.type === 'type_spec' && field('name')) result.declarations.push(field('name')!.text)
      if (node.type === 'type_identifier') result.references.push(node.text)
    } else if (language === 'rust') {
      if (
        [
          'struct_item',
          'enum_item',
          'type_item',
          'function_item',
          'const_item',
          'static_item',
          'trait_item',
        ].includes(node.type) &&
        field('name')
      )
        result.declarations.push(field('name')!.text)
      if (node.type === 'use_declaration' && field('argument'))
        result.imports.push(...rustUse(field('argument')!))
      if (node.type === 'mod_item' && !field('body'))
        result.imports.push('self::' + (field('name')?.text ?? ''))
    } else {
      if (['package_declaration', 'package_header'].includes(node.type))
        result.namespace = children[0]?.text ?? ''
      if (['namespace_declaration', 'file_scoped_namespace_declaration'].includes(node.type)) {
        // Multiple namespaces in one file cannot be represented as one unambiguous module.
        const namespace = field('name')?.text ?? ''
        if (result.namespace && result.namespace !== namespace) return false
        result.namespace = namespace
      }
      if (['import_declaration', 'import_header', 'using_directive'].includes(node.type)) {
        const target =
          children.find(
            (child) => !['name_equals', 'import_alias', 'asterisk'].includes(child.type),
          )?.text ?? ''
        result.imports.push(target + (node.text.includes('*') ? '.*' : ''))
      }
      if (
        [
          'class_declaration',
          'interface_declaration',
          'enum_declaration',
          'record_declaration',
          'struct_declaration',
          'object_declaration',
          'protocol_declaration',
          'typealias_declaration',
          'type_alias',
          'delegate_declaration',
        ].includes(node.type)
      ) {
        const name = field('name') ?? children.find((child) => child.type === 'type_identifier')
        if (name) result.declarations.push(name.text)
      }
      if (node.type === 'type_identifier') result.references.push(node.text)
      if (node.type === 'scoped_type_identifier') result.references.push(node.text)
      if (language === 'kotlin' && node.parent?.type === 'source_file') {
        if (node.type === 'function_declaration') {
          const name = children.find((child) => child.type === 'simple_identifier')
          if (name) result.declarations.push(name.text)
        }
        if (node.type === 'property_declaration') {
          const name = children
            .find((child) => child.type === 'variable_declaration')
            ?.namedChildren.find((child) => child?.type === 'simple_identifier')
          if (name) result.declarations.push(name.text)
        }
      }
      if (language === 'c_sharp') {
        const type = field('type')
        if (type) result.references.push(type.text)
        if (['base_list', 'type_argument_list'].includes(node.type))
          result.references.push(...children.map((child) => child.text))
      }
    }
    for (const child of children.reverse()) pending.push(child)
  }
  return true
}
export function analyzeReviewSource(path: string, source: string): Promise<SourceAnalysis | null> {
  const language = reviewLanguage(path)
  if (!language || source.length > 300_000) return Promise.resolve(null)
  const key = createHash('sha256').update(path).update('\0').update(source).digest('hex')
  const existing = cache.get(key)
  if (existing) return existing
  const pending = (async () => {
    const result: SourceAnalysis = {
      language,
      imports: [],
      namespace: '',
      declarations: [],
      references: [],
    }
    if (language === 'javascript') {
      try {
        javascript(source, path, result)
        return result
      } catch {
        return null
      }
    }
    // Load errors are deployment failures; don't silently present them as unsupported syntax.
    const parsedLanguage = await grammar(language)
    const { Parser } = await engine!
    const parser = new Parser()
    try {
      parser.setLanguage(parsedLanguage)
      const tree = parser.parse(source)
      if (!tree) return null
      try {
        if (tree.rootNode.hasError || !inspect(tree.rootNode, result)) return null
        result.imports = [...new Set(result.imports)]
        result.declarations = [...new Set(result.declarations)]
        result.references = [...new Set(result.references)]
        return result
      } finally {
        tree.delete()
      }
    } finally {
      parser.delete()
    }
  })()
  if (cache.size >= 256) cache.delete(cache.keys().next().value ?? '')
  cache.set(key, pending)
  void pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key)
  })
  return pending
}
