import type { ReactNode } from 'react'

/** Keep page identity separate from variable-height filters and content. */
export function PageHeader({
  title,
  description,
  children,
  leading,
}: {
  title: ReactNode
  description?: ReactNode
  leading?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="studio-page-header border-b">
      {leading}
      <div className="studio-page-heading">
        <h1>{title}</h1>
        {description && <p className="studio-page-description">{description}</p>}
      </div>
      {children && <div className="studio-page-actions">{children}</div>}
    </header>
  )
}
