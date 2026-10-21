import { hostedStyles } from '@dovo/design'
import { webUiStyles } from '@dovo/web-ui/styles'

export const artifactPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Dovo Artifacts</title><style>
${hostedStyles}
${webUiStyles}
body{margin:0}main{width:min(100% - 32px,1100px);margin:auto;padding:clamp(20px,4vw,40px) 0}header{display:flex;gap:16px;align-items:center;flex-wrap:wrap}header h1{font-size:24px;margin:0}h2{font-size:19px}button,a{overflow-wrap:anywhere}#content>section,#auth>section{margin:16px 0}p{line-height:1.6}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:12px 0}.muted{color:var(--dovo-muted-foreground);font-size:14px}.error{color:var(--dovo-status-error)}code{overflow-wrap:anywhere;white-space:pre-wrap}iframe{display:block;width:100%;height:70vh;border:1px solid var(--line);border-radius:12px;background:white}#status{min-height:24px}[hidden]{display:none!important}label{display:block;margin-bottom:8px}
</style></head><body><div id="app"><main><header><h1>Dovo Artifacts</h1><a href="/">Your published artifacts</a></header><p id="status" role="status" aria-live="polite">Loading…</p><noscript>Enable JavaScript to sign in and manage hosted artifacts.</noscript></main></div><script src="/viewer.js" defer></script></body></html>`
