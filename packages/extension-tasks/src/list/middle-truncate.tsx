/*!
 * Adapted from T3 Code's middle-truncate.tsx at 8ee7183e6c8a1c22a6698f4909ef7e2a423bec3a.
 * https://github.com/pingdotgg/t3code/blob/8ee7183e6c8a1c22a6698f4909ef7e2a423bec3a/apps/web/src/components/ui/middle-truncate.tsx
 *
 * MIT License
 * Copyright (c) 2026 T3 Tools Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { type ComponentProps, useLayoutEffect, useRef } from 'react'
import { cn } from '@dovo/studio-ui'

export function MiddleTruncate({
  value,
  className,
  ...props
}: Omit<ComponentProps<'span'>, 'children'> & { value: string }) {
  const split = splitForMiddleTruncate(value)
  const headRef = useRef<HTMLSpanElement>(null)
  const head = split?.head
  useLayoutEffect(() => {
    const element = headRef.current
    if (!element || head === undefined) return
    fitHead(element)
    const observer = new ResizeObserver(() => fitHead(element))
    observer.observe(element)
    return () => observer.disconnect()
  }, [head])
  return (
    <span
      title={value}
      className={cn('inline-flex min-w-0 max-w-full overflow-hidden whitespace-nowrap', className)}
      {...props}
    >
      {split ? (
        <>
          <span ref={headRef} className="peer min-w-0 overflow-hidden">
            {split.head}
          </span>
          <span className="shrink-0 peer-data-overflow:before:content-['…']">{split.tail}</span>
        </>
      ) : (
        <span key="whole" className="min-w-0 truncate">
          {value}
        </span>
      )}
    </span>
  )
}

// Cut the overflowing prefix at a whole character. Translate the suffix across the unused
// fraction of that character so the ellipsis has no gap. These styles do not change layout.
function fitHead(head: HTMLElement) {
  const text = head.firstChild
  const overflowing = head.scrollWidth > head.clientWidth && text instanceof Text
  head.toggleAttribute('data-overflow', overflowing)
  let slack = 0
  if (overflowing) {
    const range = document.createRange()
    const left = head.getBoundingClientRect().left
    const widthTo = (end: number) => {
      range.setStart(text, 0)
      range.setEnd(text, end)
      return range.getBoundingClientRect().right - left
    }
    let fits = 0
    let over = text.length
    while (over - fits > 1) {
      const mid = (fits + over) >> 1
      if (widthTo(mid) <= head.clientWidth) fits = mid
      else over = mid
    }
    if (/[\uD800-\uDBFF]/.test(text.data[fits - 1] ?? '')) fits -= 1
    slack = Math.max(0, head.clientWidth - widthTo(fits))
  }
  head.style.clipPath = slack > 0 ? `inset(-0.25em ${slack}px -0.25em 0)` : ''
  const tail = head.nextElementSibling
  if (tail instanceof HTMLElement) tail.style.translate = slack > 0 ? `-${slack}px 0` : ''
}

const WORD_BREAK = /[-_./]/

export function splitForMiddleTruncate(value: string): { head: string; tail: string } | null {
  const chars = Array.from(value)
  let keep = 10
  const slash = chars.lastIndexOf('/')
  if (slash > 0 && slash < chars.length - 1) {
    const segment = chars.length - slash - 1
    keep = segment <= 16 ? segment : 10
  }
  if (chars.length <= keep + 4) return null
  let cut = chars.length - keep
  if (!WORD_BREAK.test(chars[cut - 1]!)) {
    const startsWord = (index: number) => WORD_BREAK.test(chars[index - 1]!)
    let snapped = -1
    for (let index = cut + 1; index <= chars.length - 4; index++) {
      if (startsWord(index)) {
        snapped = index
        break
      }
    }
    for (let index = cut - 1; snapped < 0 && index >= chars.length - 16 && index > 4; index--) {
      if (startsWord(index)) snapped = index
    }
    if (snapped > 0) cut = snapped
  }
  return { head: chars.slice(0, cut).join(''), tail: chars.slice(cut).join('') }
}
