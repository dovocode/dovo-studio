'use client'

import { useEffect } from 'react'

export function SiteEffects() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const elements = document.querySelectorAll<HTMLElement>(
      '.section-heading, .feature-card, .product-tour, .automation-showcase, .ownership, .mobile-availability, .server-setup, .faq > div, .closing',
    )
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.08 },
    )
    elements.forEach((element) => {
      element.classList.add('reveal')
      observer.observe(element)
    })
    return () => {
      observer.disconnect()
      elements.forEach((element) => element.classList.remove('reveal', 'is-visible'))
    }
  }, [])
  return null
}
