import type { ComponentProps } from 'react'

/** Catalog-only Next boundary: real pages retain semantic links without routing out of the frame. */
export default function Link(props: ComponentProps<'a'>) {
  return <a {...props} />
}
