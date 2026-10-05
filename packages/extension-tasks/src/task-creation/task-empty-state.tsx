import { Button } from '@dovo/studio-ui'

export function TaskEmptyState({ onBrowse }: { onBrowse?: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
      <h2 className="text-base font-medium">What would you like to work on?</h2>
      <p className="text-sm text-muted-foreground">Describe a change or ask a question.</p>
      {onBrowse && (
        <Button variant="outline" onClick={onBrowse}>
          Browse tasks
        </Button>
      )}
    </div>
  )
}
