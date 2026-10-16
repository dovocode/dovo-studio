import { marked } from 'marked'
import { artifactSourceMarkdown, type Artifact } from '@dovo/protocol'

/** HTML/SVG keep authored print styles; documents and code get readable page defaults. */
export function artifactPrintContent(artifact: Artifact) {
  if (artifact.format === 'html' || artifact.format === 'svg') return artifact.content
  const body = marked.parse(
    artifact.format === 'code' ? artifactSourceMarkdown(artifact) : artifact.content,
    { async: false, gfm: true },
  )
  return `<style>
body{margin:0;font-size:11pt;line-height:1.55;overflow-wrap:anywhere}
h1,h2,h3,h4,h5,h6{line-height:1.25;break-after:avoid}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f5;padding:12px;border-radius:6px;font-size:9pt}
code{font-size:.9em}pre code{font-size:inherit}
img,svg{max-width:100%;height:auto}table{width:100%;font-size:10pt}
tr,img,blockquote{break-inside:avoid}thead{display:table-header-group}
blockquote{margin-left:0;padding-left:14px;border-left:3px solid #ddd;color:#444}
p{orphans:3;widows:3}
</style>${body}`
}
