import type { MetadataRoute } from 'next'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://dovo.studio/', priority: 1 },
    { url: 'https://dovo.studio/download/', priority: 0.8 },
    { url: 'https://dovo.studio/docs/', priority: 0.8 },
  ]
}
