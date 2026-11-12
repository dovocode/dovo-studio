import { Check } from 'lucide-react'
import { toggleQuestionChoice, type AgentQuestion, type QuestionDraft } from '@dovo/protocol'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { cn } from './lib/utils'
export function QuestionField({
  question: q,
  value,
  onChange,
  disabled,
  shortcutNumbers = false,
}: {
  question: AgentQuestion
  value: QuestionDraft
  onChange: (next: QuestionDraft) => void
  disabled?: boolean
  shortcutNumbers?: boolean
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="mb-1 text-[0.6875rem] font-medium text-muted-foreground">
        {q.header}
        {!q.required && <span className="ml-1 text-muted-foreground">(optional)</span>}
      </legend>
      <p className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed font-medium">
        {q.question}
      </p>
      {q.multiple && <p className="text-[0.625rem] text-muted-foreground">Select all that apply</p>}
      <div className="grid gap-2">
        {q.options.map((option, index) => (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            disabled={disabled}
            aria-pressed={value.selected.includes(option.value)}
            className={cn(
              'h-auto min-h-11 w-full items-start justify-start gap-3 rounded-[10px] border border-border/70 px-3 py-2.5 text-left whitespace-normal shadow-none',
              value.selected.includes(option.value) &&
                'border-primary/60 bg-primary/5 hover:bg-primary/10',
            )}
            onClick={() => onChange(toggleQuestionChoice(q, value, option.value))}
          >
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center border',
                q.multiple ? 'rounded' : 'rounded-full',
                value.selected.includes(option.value)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-muted-foreground/50',
              )}
            >
              {value.selected.includes(option.value) &&
                (q.multiple ? (
                  <Check className="size-3" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                ))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs leading-5">{option.label}</span>
              {option.description && (
                <span className="mt-0.5 block text-[0.6875rem] font-normal leading-relaxed text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
            {shortcutNumbers && index < 9 && (
              <kbd
                aria-hidden="true"
                className="mt-0.5 hidden size-5 shrink-0 items-center justify-center rounded border border-border/60 font-sans text-[0.625rem] text-muted-foreground sm:inline-flex"
              >
                {index + 1}
              </kbd>
            )}
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
          className="h-9 rounded-[10px] bg-transparent px-3 text-xs shadow-none"
        />
      )}
    </fieldset>
  )
}
