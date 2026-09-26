import { Check, Circle } from 'lucide-react'
import { toggleQuestionChoice, type AgentQuestion, type QuestionDraft } from '@dovo/protocol'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { cn } from './lib/utils'
export function QuestionField({
  question: q,
  value,
  onChange,
  disabled,
}: {
  question: AgentQuestion
  value: QuestionDraft
  onChange: (next: QuestionDraft) => void
  disabled?: boolean
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2">
      <legend className="mb-1 text-xs font-medium">
        {q.header}
        {!q.required && <span className="ml-1 text-muted-foreground">(optional)</span>}
      </legend>
      <p className="whitespace-pre-wrap text-xs leading-relaxed">{q.question}</p>
      {q.multiple && <p className="text-[0.625rem] text-muted-foreground">Select all that apply</p>}
      <div className="grid gap-1.5 sm:grid-cols-2">
        {q.options.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-pressed={value.selected.includes(option.value)}
            className={cn(
              'h-auto min-h-9 items-start justify-start gap-2 whitespace-normal px-2 py-2 text-left',
              value.selected.includes(option.value) && 'border-primary/60 bg-accent',
            )}
            onClick={() => onChange(toggleQuestionChoice(q, value, option.value))}
          >
            {value.selected.includes(option.value) ? (
              <Check className="mt-0.5 size-3 shrink-0" />
            ) : (
              <Circle className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0">
              <span className="block text-xs">{option.label}</span>
              {option.description && (
                <span className="mt-0.5 block text-[0.6875rem] font-normal leading-relaxed text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
          </Button>
        ))}
      </div>
      {q.custom && (
        <Input
          aria-label={`Answer: ${q.header || q.question}`}
          type={q.secret ? 'password' : q.inputType}
          step={q.inputType === 'number' ? 'any' : undefined}
          autoComplete="off"
          placeholder={q.options.length ? 'Or write your own answer…' : 'Your answer…'}
          value={value.text}
          onChange={(event) =>
            onChange({ selected: q.multiple ? value.selected : [], text: event.target.value })
          }
          className="h-8 text-xs"
        />
      )}
    </fieldset>
  )
}
