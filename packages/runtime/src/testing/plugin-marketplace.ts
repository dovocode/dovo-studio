import type { MarketplaceFetch } from '../agents/plugins/marketplace.js'

export const first = 'a'.repeat(40)
export const second = 'b'.repeat(40)
/** A GitHub repository at two revisions, served from memory. Requests are recorded. */
export function pluginRepository() {
  const formatter = {
    'plugins/formatter/.claude-plugin/plugin.json': JSON.stringify({
      name: 'formatter',
      description: 'Formats code',
      version: '1.2.0',
    }),
    'plugins/formatter/commands/format.md': '# Format the file',
    'plugins/formatter/skills/tidy/SKILL.md': '---\nname: tidy\ndescription: Tidy\n---\nTidy.',
    'plugins/formatter/hooks/hooks.json': '{"hooks":{}}',
    'plugins/formatter/.mcp.json': JSON.stringify({ mcpServers: { lint: { command: 'lint' } } }),
  }
  const revisions: Record<string, Record<string, string>> = {
    [first]: {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'Team tools',
        owner: { name: 'Team' },
        plugins: [
          { name: 'formatter', source: './plugins/formatter', description: 'Formats code' },
          { name: 'remote', source: { source: 'github', repo: 'other/plugin' } },
          { name: 'escape', source: '../outside' },
          { name: 'linked', source: './plugins/linked' },
        ],
      }),
      '.agents/plugins/marketplace.json': JSON.stringify({
        name: 'team-tools',
        plugins: [
          { name: 'formatter', source: { source: 'local', path: './plugins/formatter' } },
          { name: 'notes', source: { source: 'local', path: './plugins/notes' } },
        ],
      }),
      ...formatter,
      'plugins/notes/.codex-plugin/plugin.json': JSON.stringify({ name: 'notes' }),
      'plugins/notes/skills/notes/SKILL.md': '---\nname: notes\ndescription: Notes\n---\nNotes.',
      'plugins/linked/.claude-plugin/plugin.json': '{}',
    },
  }
  revisions[second] = {
    ...revisions[first],
    'plugins/formatter/commands/format.md': '# Format the file, revised',
  }
  let head = first
  const requests: string[] = []
  const tree = (revision: string) => {
    const files = Object.keys(revisions[revision])
    const folders = new Set(
      files.flatMap((path) =>
        path
          .split('/')
          .slice(0, -1)
          .map((_, index, parts) => parts.slice(0, index + 1).join('/')),
      ),
    )
    return {
      truncated: false,
      tree: [
        ...[...folders].map((path) => ({ path, type: 'tree', mode: '040000' })),
        ...files.map((path) => ({
          path,
          type: 'blob',
          mode: '100644',
          size: revisions[revision][path].length,
        })),
        // A symlink inside a plugin is refused at review and install.
        { path: 'plugins/linked/escape', type: 'blob', mode: '120000', size: 10 },
      ],
    }
  }
  const fetcher: MarketplaceFetch = {
    json: async (url) => {
      requests.push(url)
      const commit = /\/repos\/team\/tools\/commits\/(.+)$/.exec(url)
      if (commit) return { sha: commit[1] === 'HEAD' ? head : commit[1] }
      const listing = /\/repos\/team\/tools\/git\/trees\/([a-f0-9]{40})\?recursive=1$/.exec(url)
      if (listing && revisions[listing[1]]) return tree(listing[1])
      throw new Error(`Catalog request failed (404). ${url}`)
    },
    bytes: async (url) => {
      requests.push(url)
      const match =
        /^https:\/\/raw\.githubusercontent\.com\/team\/tools\/([a-f0-9]{40})\/(.+)$/.exec(url)
      const contents = match && revisions[match[1]]?.[decodeURIComponent(match[2])]
      if (contents === undefined || contents === null) throw new Error(`Missing ${url}`)
      return Buffer.from(contents)
    },
  }
  return {
    fetcher,
    requests,
    advance: () => {
      head = second
    },
  }
}
