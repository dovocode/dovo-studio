import type { ComponentProps } from 'react'

/** The catalog serves original public assets, without Next image optimization. */
export default function Image({
  preload: _preload,
  ...props
}: ComponentProps<'img'> & { preload?: boolean }) {
  return (
    <img
      {...props}
      src={
        typeof props.src === 'string' && props.src.startsWith('/')
          ? `/website${props.src}`
          : props.src
      }
    />
  )
}
