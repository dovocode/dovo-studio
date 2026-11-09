import type { ComponentProps } from 'react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
export function IconButton({ label, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <Button
          variant={
            props['aria-pressed'] === true || props['aria-pressed'] === 'true'
              ? 'secondary'
              : 'ghost'
          }
          size="icon"
          aria-label={label}
          {...props}
        />
      </TooltipTrigger>
      <TooltipContent className="studio-icon-tooltip">{label}</TooltipContent>
    </Tooltip>
  )
}
