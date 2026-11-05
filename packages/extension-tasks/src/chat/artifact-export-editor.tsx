import { useResolvedTheme, offlineEditorFont } from '@dovo/studio-core'
import { useRef } from 'react'
import {
  themedArtifactExportEditorDocument,
  initializeArtifactExportEditor,
  type ArtifactExportEdit,
} from '@dovo/protocol'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'

export function ArtifactExportEditor({
  content,
  onAction,
}: {
  content: string
  onAction: (edit: ArtifactExportEdit) => void
}) {
  const theme = useResolvedTheme()
  const onEdit = useRef(onAction)
  onEdit.current = onAction
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onEdit.current({ action: 'cancel' })
      }}
    >
      <DialogContent className="flex h-[92dvh] w-[min(1120px,96vw)] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 [&_[data-dialog-close]]:hidden">
        <DialogTitle className="sr-only">Edit export copy</DialogTitle>
        <DialogDescription className="sr-only">
          Edit text, delete elements or exclude sections without changing the saved artifact.
        </DialogDescription>
        <iframe
          title="Export editor"
          className="h-full min-h-0 w-full border-0"
          sandbox="allow-same-origin"
          referrerPolicy="no-referrer"
          srcDoc={themedArtifactExportEditorDocument(theme, offlineEditorFont)}
          onLoad={(event) => {
            const doc = event.currentTarget.contentDocument
            if (doc) initializeArtifactExportEditor(doc, content, (edit) => onEdit.current(edit))
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
