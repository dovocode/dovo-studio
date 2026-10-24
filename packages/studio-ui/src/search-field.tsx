import { useRef, type ComponentPropsWithoutRef, type RefObject } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { cn } from './lib/utils'

export function SearchField({
  value,
  onValueChange,
  className,
  containerClassName,
  clearLabel = 'Clear search',
  inputRef,
  disabled,
  readOnly,
  ...props
}: Omit<ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'type'> & {
  'aria-label': string
  value: string
  onValueChange: (value: string) => void
  clearLabel?: string
  containerClassName?: string
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  const localRef = useRef<HTMLInputElement>(null)
  const input = inputRef ?? localRef
  const clearable = value.length > 0 && !disabled && !readOnly
  return (
    <div className={cn('relative min-w-0', containerClassName)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        {...props}
        ref={input}
        type="text"
        disabled={disabled}
        readOnly={readOnly}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn('h-9 pl-9 pr-10 text-sm pointer-coarse:pr-12', className)}
      />
      {clearable && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute right-0.5 top-1/2 size-8 -translate-y-1/2"
          aria-label={clearLabel}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onValueChange('')
            input.current?.focus()
          }}
        >
          <X aria-hidden="true" className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
