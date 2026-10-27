import { Button } from '@dovo/studio-ui'

export function TaskEmptyState({
  onBrowse,
  projectName,
  welcome = false,
}: {
  onBrowse?: () => void
  projectName?: string
  welcome?: boolean
}) {
  return (
    <div
      data-thread-start=""
      className={`flex min-h-0 flex-col items-center justify-center gap-3 px-5 text-center ${welcome ? 'mt-auto shrink-0 pb-6 pt-8' : 'flex-1 py-8'}`}
    >
      <p className="text-[0.625rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        A fresh start
      </p>
      <h2 className="max-w-xl text-balance text-2xl font-medium tracking-tight sm:text-3xl">
        What would you like to work on?
      </h2>
      {projectName ? (
        <p className="max-w-full break-words text-sm text-muted-foreground">
          In <span className="font-medium text-foreground">{projectName}</span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          An idea, a tricky bug, or something to explore.
        </p>
      )}
      {onBrowse && (
        <Button variant="ghost" size="sm" onClick={onBrowse} className="text-muted-foreground">
          Browse threads
        </Button>
      )}
    </div>
  )
}
