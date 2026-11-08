import type { ReviewGuide } from '@dovo/protocol'
import { Button } from '../components/ui/button'

export function ReviewGuideCard({
  guide,
  busy,
  disabled,
  onMove,
  onOpenFile,
}: {
  guide: ReviewGuide
  busy: boolean
  disabled: boolean
  onMove: (position: number, reviewed?: number) => Promise<boolean>
  onOpenFile: (path: string) => void
}) {
  const step = guide.steps[guide.position]
  if (!step) return null
  const blocked = busy || disabled
  return (
    <details key={guide.id} open className="my-2 rounded-lg border p-3" aria-label="Guided review">
      <summary className="cursor-pointer font-medium">
        Guided review · {guide.seen.length}/{guide.steps.length} steps reviewed
      </summary>
      <p className="my-2 text-muted-foreground">
        Model-proposed walkthrough. Verify explanations against the diff. Progress is saved for this
        revision.
      </p>
      <nav aria-label="Review steps" className="mb-3 flex flex-wrap gap-1">
        {guide.steps.map((item, index) => (
          <Button
            key={index}
            size="sm"
            variant={index === guide.position ? 'secondary' : 'ghost'}
            disabled={blocked}
            aria-current={index === guide.position ? 'step' : undefined}
            onClick={() => void onMove(index)}
          >
            {guide.seen.includes(index) ? '✓ ' : ''}
            {index + 1}. {item.title}
          </Button>
        ))}
      </nav>
      <h4 className="font-semibold">
        Step {guide.position + 1}: {step.title}
      </h4>
      <p className="mt-2 whitespace-pre-wrap">{step.summary}</p>
      <p className="mt-2 whitespace-pre-wrap text-muted-foreground">Review focus: {step.impact}</p>
      {step.excerpts.map((excerpt, index) => (
        <figure key={index} className="mt-3 overflow-hidden rounded-md border">
          <figcaption className="break-all bg-muted/40 px-2 py-1">
            {excerpt.path}:{excerpt.start}–{excerpt.end} ·{' '}
            {excerpt.side === 'after' ? 'new' : 'old'} version
          </figcaption>
          <pre className="max-h-64 overflow-auto p-2 text-[11px]">
            <code>{excerpt.text}</code>
          </pre>
        </figure>
      ))}
      {!step.excerpts.length && (
        <p className="mt-2 text-muted-foreground">
          No verified excerpt is available for this step. Inspect the full file diffs.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {step.paths.map((path) => (
          <Button
            key={path}
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onOpenFile(path)}
          >
            Open {path}
          </Button>
        ))}
      </div>
      {!!step.questions.length && (
        <div className="mt-3">
          <p className="font-medium">Questions to check</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {step.questions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={blocked || guide.position === 0}
          onClick={() => void onMove(guide.position - 1)}
        >
          Previous step
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={blocked || guide.position === guide.steps.length - 1}
          onClick={() => void onMove(guide.position + 1)}
        >
          Next step
        </Button>
        <Button
          size="sm"
          disabled={blocked || guide.seen.includes(guide.position)}
          onClick={() =>
            void onMove(Math.min(guide.position + 1, guide.steps.length - 1), guide.position)
          }
        >
          {guide.seen.includes(guide.position)
            ? 'Step reviewed'
            : guide.position === guide.steps.length - 1
              ? 'Mark final step reviewed'
              : 'Mark reviewed and continue'}
        </Button>
      </div>
      {guide.seen.length === guide.steps.length && (
        <p role="status" className="mt-2 font-medium">
          Walkthrough complete. File viewed marks and review submission remain separate.
        </p>
      )}
    </details>
  )
}
