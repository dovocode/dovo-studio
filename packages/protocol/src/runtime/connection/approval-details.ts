export type ApprovalDetailField = {
  label: string
  text?: string
  code?: boolean
  children?: ApprovalDetailField[]
}

const labels: Readonly<Record<string, string>> = {
  cwd: 'Working folder',
  workdir: 'Working folder',
  workingdirectory: 'Working folder',
  filepath: 'File',
  rawinput: 'Tool input',
  input: 'Tool input',
  toolname: 'Tool',
  networkapprovalcontext: 'Network access',
  additionalpermissions: 'Additional permissions',
  filesystem: 'File access',
  grantroot: 'Grant root',
  oldstring: 'Original text',
  newstring: 'Replacement text',
  url: 'URL',
}
const priority = [
  'reason',
  'justification',
  'description',
  'command',
  'commands',
  'cwd',
  'workdir',
  'workingdirectory',
  'filepath',
  'path',
  'url',
  'host',
]
const technical = new Set(['threadid', 'turnid', 'itemid', 'toolcallid', 'sessionid'])
const code = new Set([
  'command',
  'commands',
  'cwd',
  'workdir',
  'workingdirectory',
  'filepath',
  'path',
  'paths',
  'patch',
  'diff',
  'content',
  'oldstring',
  'newstring',
  'script',
])
const normalize = (key: string) => key.replace(/[_-]/g, '').toLowerCase()
const scalar = (value: unknown) => {
  if (typeof value === 'string') return value || '(empty)'
  if (typeof value === 'number') return String(value)
  return value === true ? 'Yes' : value === false ? 'No' : 'Not set'
}
const label = (key: string) => {
  const normalized = normalize(key)
  if (Object.hasOwn(labels, normalized)) return labels[normalized]
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A bounded, display-only view. The original payload remains available for inspection. */
export function approvalDetails(detail: string): {
  fields: ApprovalDetailField[]
  raw: string
  json: boolean
} {
  let value: unknown
  let raw: string
  try {
    value = JSON.parse(detail)
    raw = JSON.stringify(value, null, 2)
  } catch {
    return { fields: [{ label: '', text: detail }], raw: detail, json: false }
  }
  let remaining = 120
  const fields = (value: unknown, depth: number): ApprovalDetailField[] => {
    const entries = Array.isArray(value)
      ? value.map((item: unknown, index) => [String(index + 1), item] as const)
      : value !== null && typeof value === 'object'
        ? Object.entries(value).sort(([a], [b]) => {
            const rank = (key: string) => {
              const index = priority.indexOf(normalize(key))
              return index < 0 ? priority.length : index
            }
            return rank(a) - rank(b)
          })
        : [['', value] as const]
    const result: ApprovalDetailField[] = []
    for (const [key, item] of entries) {
      if (depth === 0 && technical.has(normalize(key))) continue
      if (remaining-- <= 0) {
        result.push({ label: '', text: 'More details are available in Full JSON.' })
        break
      }
      const field: ApprovalDetailField = { label: label(key) }
      if (
        Array.isArray(item) &&
        item.every((value: unknown) => value === null || typeof value !== 'object')
      ) {
        field.text = item.length ? item.map(scalar).join('\n') : 'No items'
        field.code = true
      } else if (item !== null && typeof item === 'object') {
        if (depth >= 4) {
          field.text = JSON.stringify(item, null, 2)
          field.code = true
        } else {
          field.children = fields(item, depth + 1)
          if (!field.children.length) field.text = Array.isArray(item) ? 'No items' : 'No fields'
        }
      } else {
        field.text = scalar(item)
        field.code = code.has(normalize(key))
      }
      result.push(field)
    }
    return result
  }
  return { fields: fields(value, 0), raw, json: true }
}
