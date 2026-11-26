import {
  markdownNodeText,
  parseSharedMarkdown,
  type SharedMarkdownNode,
} from '../../conversation/presentation/rich-markdown.js'

type DescriptionTask = { offset: number; checked: boolean; label: string }
const marker = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|[ \t]*(?:\r\n?|\n)(?:[ \t]*>)*[ \t]*)\[[ xX]\]/

/** Source offsets identify tasks even when their labels match. */
export function pullDescriptionTasks(markdown: string): DescriptionTask[] {
  if (!/\[[ xX]\]/.test(markdown)) return []
  const tasks: DescriptionTask[] = []
  const visit = (node: SharedMarkdownNode) => {
    if (node.type === 'listItem' && typeof node.checked === 'boolean') {
      const start = node.position?.start.offset
      const paragraph = node.children.find((child) => child.type === 'paragraph')
      if (start !== undefined && paragraph) {
        const prefix = marker.exec(markdown.slice(start, node.position?.end.offset))?.[0]
        const label = markdownNodeText(paragraph).replace(/\s+/g, ' ').trim()
        if (prefix && label)
          tasks.push({ offset: start + prefix.length - 2, checked: node.checked, label })
      }
    }
    if ('children' in node) node.children.forEach(visit)
  }
  visit(parseSharedMarkdown(markdown))
  return tasks
}

export function togglePullDescriptionTask(
  markdown: string,
  task: DescriptionTask,
  checked: boolean,
) {
  if (task.checked === checked) return markdown
  const current = markdown.slice(task.offset - 1, task.offset + 2)
  if (task.checked ? !/^\[[xX]\]$/.test(current) : current !== '[ ]') return markdown
  return markdown.slice(0, task.offset) + (checked ? 'x' : ' ') + markdown.slice(task.offset + 1)
}
