/** Claude's client, server and MCP tool blocks share call IDs but use different tags. */
export function claudeToolStatus(
  block: Record<string, unknown>,
): 'running' | 'completed' | 'failed' | undefined {
  if (typeof block.type !== 'string') return undefined
  if (['tool_use', 'server_tool_use', 'mcp_tool_use'].includes(block.type)) return 'running'
  if (
    ![
      'tool_result',
      'tool_search_tool_result',
      'mcp_tool_result',
      'web_search_tool_result',
      'web_fetch_tool_result',
      'bash_code_execution_tool_result',
      'code_execution_tool_result',
      'text_editor_code_execution_tool_result',
      'advisor_tool_result',
    ].includes(block.type)
  )
    return undefined
  const content = block.content
  return block.is_error === true ||
    (content !== null &&
      typeof content === 'object' &&
      'type' in content &&
      typeof content.type === 'string' &&
      content.type.endsWith('_tool_result_error'))
    ? 'failed'
    : 'completed'
}

/** Display text and discovered names, never image data or arbitrary protocol fields. */
export function toolContentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(toolContentText).filter(Boolean).join('\n')
  if (!value || typeof value !== 'object') return ''
  if ('type' in value && value.type === 'tool_reference' && 'tool_name' in value)
    return typeof value.tool_name === 'string' ? value.tool_name : ''
  if (
    'type' in value &&
    value.type === 'tool_search_tool_search_result' &&
    'tool_references' in value
  )
    return toolContentText(value.tool_references)
  if ('type' in value && value.type === 'tool_search_tool_result_error' && 'error_code' in value)
    return typeof value.error_code === 'string' ? `Tool search failed: ${value.error_code}` : ''
  if ('text' in value && typeof value.text === 'string') return value.text
  if ('content' in value) return toolContentText(value.content)
  return ''
}
