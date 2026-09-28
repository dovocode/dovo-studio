import { useEffect, useState } from 'react'
import { Schema } from 'effect'
import { mutableStruct } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Textarea,
} from '@dovo/studio-ui'

const readSchema = mutableStruct({ text: Schema.String, version: Schema.String })
const previewSchema = mutableStruct({ diff: Schema.String, changed: Schema.Boolean })
const saveSchema = mutableStruct({ version: Schema.String })
type Name = 'AGENTS.md' | 'CLAUDE.md'
export function ProjectInstructionsDialog({
  repositoryId,
  onClose,
}: {
  repositoryId: string
  onClose: () => void
}) {
  const { request, connected } = useWorkspace()
  const [name, setName] = useState<Name>('AGENTS.md')
  const [text, setText] = useState('')
  const [version, setVersion] = useState('')
  const [diff, setDiff] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!connected) return
    let active = true
    setBusy(true)
    setError('')
    setDiff('')
    void request('/api/scm/instructions/read', { repositoryId, name }, readSchema)
      .then((result) => {
        if (active) {
          setText(result.text)
          setVersion(result.version)
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause))
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [repositoryId, name, connected, request])
  const preview = () => {
    setBusy(true)
    setError('')
    void request(
      '/api/scm/instructions/preview',
      { repositoryId, name, text, version },
      previewSchema,
    )
      .then((result) => setDiff(result.changed ? result.diff : 'No changes'))
      .catch((cause: unknown) => setError(String(cause)))
      .finally(() => setBusy(false))
  }
  const save = () => {
    setBusy(true)
    setError('')
    void request('/api/scm/instructions/save', { repositoryId, name, text, version }, saveSchema)
      .then((result) => {
        setVersion(result.version)
        setDiff('')
        onClose()
      })
      .catch((cause: unknown) => setError(String(cause)))
      .finally(() => setBusy(false))
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogTitle>Project instructions</DialogTitle>
        <DialogDescription>
          Edit the project root file. Review the diff before saving.
        </DialogDescription>
        <div className="flex gap-2">
          {(['AGENTS.md', 'CLAUDE.md'] as const).map((item) => (
            <Button
              key={item}
              variant={name === item ? 'default' : 'outline'}
              size="sm"
              onClick={() => setName(item)}
            >
              {item}
            </Button>
          ))}
        </div>
        <Textarea
          aria-label={name}
          value={text}
          disabled={busy || !connected}
          onChange={(event) => {
            setText(event.target.value)
            setDiff('')
          }}
          className="min-h-48 flex-1 font-mono text-xs"
        />
        {!!diff && (
          <pre
            aria-label="Instruction diff"
            className="max-h-48 overflow-auto rounded border bg-muted p-2 text-xs"
          >
            {diff}
          </pre>
        )}
        {!!error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy || !version} onClick={preview}>
            Review diff
          </Button>
          <Button
            disabled={busy || !connected || !version || !diff || diff === 'No changes'}
            onClick={save}
          >
            Save instructions
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
