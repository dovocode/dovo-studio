import { hostedStyles } from '@dovo/design'

export const connectPageStyles = `${hostedStyles}\nmain{width:min(100% - 32px, 560px);margin:0 auto;padding:clamp(24px,6vw,64px) 0}header{margin-bottom:28px}h1{font-size:1.4rem;margin:0}h2{font-size:1.15rem}p{line-height:1.6}form{margin:12px 0}button{min-height:44px;width:100%;text-align:left}code{display:inline-block;padding:12px 16px;font-size:1.25rem;letter-spacing:.12em;overflow-wrap:anywhere}a{overflow-wrap:anywhere}`

export function connectPage(content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>Dovo Studio sign-in</title><style>${connectPageStyles}</style></head><body><main><header><h1>Dovo Studio</h1></header>${content}</main></body></html>`
}
