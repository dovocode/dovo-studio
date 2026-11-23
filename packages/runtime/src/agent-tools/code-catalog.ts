import { z } from 'zod'

export const codeFileAliases = new Map([
  ['read', 'read_file'],
  ['grep', 'search'],
  ['ls', 'list_files'],
])

export const codeCatalogQuery = z.string().max(256).optional()
const codeCatalogTool = z
  .object({ name: z.string(), description: z.string().optional() })
  .passthrough()
export const codeCatalog = z.object({ tools: z.array(codeCatalogTool) })

export function matchesCodeCatalogQuery(query?: string) {
  const normalized = query?.toLowerCase()
  return (tool: z.infer<typeof codeCatalogTool>) =>
    !normalized || `${tool.name} ${tool.description ?? ''}`.toLowerCase().includes(normalized)
}
