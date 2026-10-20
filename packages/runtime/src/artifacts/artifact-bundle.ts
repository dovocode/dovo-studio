import { build, type Loader } from 'esbuild'
import { parse, serialize, defaultTreeAdapter as tree, type DefaultTreeAdapterMap } from 'parse5'
import { parseSrcset, stringifySrcset } from 'srcset'
import { ARTIFACT_MAX_BYTES, type ArtifactBundleFile } from '@dovo/protocol'
import { HttpError } from '../errors.js'

type Element = DefaultTreeAdapterMap['element']
const mime: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
}
const extension = (path: string) => path.split('.').at(-1)?.toLowerCase() ?? ''
export function artifactFileBytes(file: ArtifactBundleFile) {
  if (file.encoding !== 'base64') return Buffer.from(file.content, 'utf8')
  const bytes = Buffer.from(file.content, 'base64')
  if (bytes.toString('base64') !== file.content)
    throw new HttpError(400, `Invalid base64 asset: ${file.path}`)
  return bytes
}

/** Compile a virtual folder only: no filesystem resolver, packages, credentials or network. */
export async function compileArtifactBundle(files: ArtifactBundleFile[], entrypoint: string) {
  const entries = new Map(files.map((file) => [file.path, file]))
  let size = 0
  for (const file of files) {
    size += Buffer.byteLength(file.content, 'utf8')
    if (size > ARTIFACT_MAX_BYTES)
      throw new HttpError(413, 'Artifact folder exceeds the 100 MB limit')
    artifactFileBytes(file)
  }
  const entry = entries.get(entrypoint)
  if (!entry || entry.encoding === 'base64' || !/\.html?$/i.test(entrypoint))
    throw new HttpError(400, 'Choose an HTML entry file inside the artifact folder')
  const resolve = (reference: string, from: string, imports = false) => {
    if (/^(?:data:|blob:|#)/i.test(reference)) return undefined
    let url: URL
    try {
      url = new URL(reference, `https://artifact.invalid/${from}`)
    } catch {
      throw new HttpError(400, `Invalid artifact resource: ${reference}`)
    }
    if (url.origin !== 'https://artifact.invalid')
      throw new HttpError(400, `Include this resource in the artifact folder: ${reference}`)
    let path: string
    try {
      path = decodeURIComponent(url.pathname).slice(1)
    } catch {
      throw new HttpError(400, `Invalid artifact resource: ${reference}`)
    }
    const candidates = imports
      ? [
          path,
          ...['.js', '.ts', '.tsx', '.jsx', '.json', '/index.js', '/index.ts'].map(
            (ext) => path + ext,
          ),
        ]
      : [path]
    const file = candidates.map((path) => entries.get(path)).find((file) => file !== undefined)
    if (!file) throw new HttpError(400, `Missing artifact file: ${path}`)
    return file
  }
  const asset = (reference: string, from: string) => {
    const file = resolve(reference, from)
    return file
      ? `data:${mime[extension(file.path)] ?? 'application/octet-stream'};base64,${artifactFileBytes(file).toString('base64')}${new URL(reference, 'https://artifact.invalid/').hash}`
      : reference
  }
  const styles: string[] = []
  const bundle = async (content: string, from: string, loader: Loader) => {
    try {
      const result = await build({
        stdin: { contents: content, loader, sourcefile: from, resolveDir: '/' },
        bundle: true,
        // Classic script globals can be referenced by HTML handlers or later scripts.
        treeShaking: false,
        write: false,
        outdir: '/artifact-output',
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        legalComments: 'none',
        logLevel: 'silent',
        plugins: [
          {
            name: 'artifact-folder',
            setup(builder) {
              builder.onResolve({ filter: /.*/ }, (args) => {
                if (
                  !/^(?:\.{1,2}\/|\/)/.test(args.path) &&
                  args.kind !== 'url-token' &&
                  args.kind !== 'import-rule'
                )
                  return { errors: [{ text: `Use a bundled relative import: ${args.path}` }] }
                const file = resolve(
                  args.path,
                  args.namespace === 'artifact' ? args.importer : from,
                  true,
                )
                if (!file) return { errors: [{ text: `Use a bundled file: ${args.path}` }] }
                return {
                  path: file.path,
                  namespace: 'artifact',
                  suffix: new URL(args.path, 'https://artifact.invalid/').hash,
                  pluginData: { asset: args.kind === 'url-token' },
                }
              })
              builder.onLoad({ filter: /.*/, namespace: 'artifact' }, (args) => {
                const file = entries.get(args.path)
                if (!file) return { errors: [{ text: `Missing artifact file: ${args.path}` }] }
                const ext = extension(file.path)
                const loaders: Record<string, Loader> = {
                  js: 'js',
                  mjs: 'js',
                  ts: 'ts',
                  jsx: 'jsx',
                  tsx: 'tsx',
                  css: 'css',
                  json: 'json',
                }
                const loader = args.pluginData?.asset ? 'dataurl' : (loaders[ext] ?? 'dataurl')
                return { contents: artifactFileBytes(file), loader }
              })
            },
          },
        ],
      })
      const main = result.outputFiles.find((file) =>
        file.path.endsWith(loader === 'css' ? '.css' : '.js'),
      )
      if (loader !== 'css')
        styles.push(
          ...result.outputFiles
            .filter((file) => file.path.endsWith('.css'))
            .map((file) => file.text),
        )
      return main?.text ?? ''
    } catch (error) {
      throw new HttpError(
        400,
        `Could not build artifact file ${from}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  const document = parse(entry.content)
  const deferred: Element[] = []
  const elements: Element[] = []
  const pending: DefaultTreeAdapterMap['node'][] = [document]
  while (pending.length) {
    const node = pending.pop()!
    if ('tagName' in node) elements.push(node)
    if ('childNodes' in node)
      for (let index = node.childNodes.length - 1; index >= 0; index--)
        pending.push(node.childNodes[index]!)
    if ('content' in node && node.tagName === 'template') pending.push(node.content)
  }
  const attribute = (element: Element, name: string) =>
    element.attrs.find((attr) => attr.name === name)
  const text = (element: Element) =>
    tree.getTextNodeContent(
      element.childNodes.find((node) => tree.isTextNode(node)) ?? tree.createTextNode(''),
    )
  const replaceText = (element: Element, value: string) => {
    element.childNodes = []
    tree.insertText(element, value)
  }
  for (const element of elements) {
    if (element.tagName === 'script') {
      const type = attribute(element, 'type')?.value
      if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue
      const src = attribute(element, 'src')
      const file = src && resolve(src.value, entrypoint)
      if (src && !file) throw new HttpError(400, 'Use a bundled JavaScript file')
      const defer =
        type !== 'module' &&
        !!src &&
        element.attrs.some((attr) => ['async', 'defer'].includes(attr.name))
      const code = await bundle(
        file ? artifactFileBytes(file).toString('utf8') : text(element),
        file?.path ?? entrypoint,
        'js',
      )
      element.attrs = element.attrs.filter(
        (attr) => !['src', 'integrity', 'crossorigin', 'async', 'defer'].includes(attr.name),
      )
      replaceText(element, code)
      if (defer) deferred.push(element)
    } else if (
      element.tagName === 'link' &&
      attribute(element, 'rel')?.value.toLowerCase() === 'stylesheet'
    ) {
      const file = resolve(attribute(element, 'href')?.value ?? '', entrypoint)
      if (!file) throw new HttpError(400, 'Use a bundled stylesheet')
      element.tagName = 'style'
      element.nodeName = 'style'
      element.attrs = element.attrs.filter((attr) => ['media', 'title'].includes(attr.name))
      replaceText(element, await bundle(artifactFileBytes(file).toString('utf8'), file.path, 'css'))
    } else if (element.tagName === 'style') {
      replaceText(element, await bundle(text(element), entrypoint, 'css'))
    } else {
      for (const attr of element.attrs) {
        if (
          attr.name === 'src' ||
          attr.name === 'poster' ||
          (attr.name === 'href' && ['image', 'use', 'link'].includes(element.tagName))
        )
          attr.value = asset(attr.value, entrypoint)
      }
    }
    for (const attr of element.attrs) {
      if (attr.name === 'srcset' || attr.name === 'imagesrcset') {
        attr.value = stringifySrcset(
          parseSrcset(attr.value).map((candidate) => ({
            ...candidate,
            url: asset(candidate.url, entrypoint),
          })),
        )
      } else if (attr.name === 'style') {
        const css = await bundle(`.artifact-inline { ${attr.value} }`, entrypoint, 'css')
        attr.value = css.slice(css.indexOf('{') + 1, css.lastIndexOf('}')).trim()
      }
    }
  }
  const body = elements.find((element) => element.tagName === 'body')
  if (body)
    for (const script of deferred) {
      tree.detachNode(script)
      tree.appendChild(body, script)
    }
  const head = elements.find((element) => element.tagName === 'head')
  if (head)
    for (const css of styles) {
      const style = tree.createElement('style', head.namespaceURI, [])
      tree.insertText(style, css)
      tree.appendChild(head, style)
    }
  const content = serialize(document)
  if (Buffer.byteLength(content, 'utf8') > ARTIFACT_MAX_BYTES)
    throw new HttpError(413, 'Artifact preview exceeds the 100 MB limit')
  return content
}
