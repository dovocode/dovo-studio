import type { ReactNode } from 'react'
import { HeaderContent } from './sidebar-header'

/** Keep page identity separate from variable-height filters and content. */
export function PageHeader({
  title,
  description,
  children,
  leading,
  embedded = false,
}: {
  title: ReactNode
  description?: ReactNode
  leading?: ReactNode
  children?: ReactNode
  embedded?: boolean
}) {
  return (
    <HeaderContent enabled={!embedded}>
      <header
        className="studio-page-header border-b"
        data-window-edge={!embedded || undefined}
        data-window-right-edge={!embedded || undefined}
        data-embedded={embedded || undefined}
      >
        {leading}
        <div className="studio-page-heading">
          <h1>{title}</h1>
          {description && <p className="studio-page-description">{description}</p>}
        </div>
        {children && (
          <div className="studio-page-actions" role="group" aria-label="Page actions" tabIndex={0}>
            {children}
          </div>
        )}
      </header>
    </HeaderContent>
  )
}
