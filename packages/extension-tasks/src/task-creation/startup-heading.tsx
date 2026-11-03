import type { ComponentProps } from 'react'

/** The same welcome spacing and heading for thread, terminal and mixed-workspace starters. */
export function StartupHeading({
  welcome = true,
  children,
  ...props
}: ComponentProps<'div'> & { welcome?: boolean }) {
  return (
    <div
      {...props}
      className={`flex min-h-0 flex-col items-center justify-center px-5 text-center ${welcome ? 'mt-auto shrink-0 gap-6 pb-6 pt-8' : 'flex-1 gap-2 py-6'}`}
    >
      <h2 className="startup-heading max-w-xl text-balance text-xl font-medium tracking-tight sm:text-2xl">
        What would you like to work on?
      </h2>
      {children}
    </div>
  )
}
