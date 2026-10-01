import { Component, isValidElement, type ReactNode } from 'react'
import type { ComponentLibrary } from '@mcp-ui/legacy'
function children(value: unknown): ReactNode {
  if (typeof value === 'string' || typeof value === 'number' || isValidElement(value)) return value
  return Array.isArray(value) ? value.map(children) : null
}
/** Only known props reach host DOM; Remote DOM must never create arbitrary host elements. */
export const legacyLibrary: ComponentLibrary = {
  name: 'dovo-basic',
  elements: [
    {
      tagName: 'ui-card',
      component: (props) => (
        <div style={{ padding: 8, border: '1px solid #777', borderRadius: 8 }}>
          {children(props.children)}
        </div>
      ),
    },
    {
      tagName: 'ui-text',
      component: (props) => (
        <span>{typeof props.content === 'string' ? props.content : children(props.children)}</span>
      ),
    },
    {
      tagName: 'ui-button',
      component: (props) => (
        <button
          type="button"
          onClick={() => {
            if (typeof props.onPress === 'function') props.onPress()
            if (typeof props.onClick === 'function') props.onClick()
          }}
        >
          {typeof props.label === 'string' ? props.label : children(props.children)}
        </button>
      ),
    },
    {
      tagName: 'ui-stack',
      component: (props) => (
        <div
          style={{
            display: 'flex',
            flexDirection: props.direction === 'horizontal' ? 'row' : 'column',
            gap: 8,
          }}
        >
          {children(props.children)}
        </div>
      ),
    },
    {
      tagName: 'ui-image',
      component: (props) =>
        typeof props.src === 'string' && /^(https?:|data:image\/|blob:)/i.test(props.src) ? (
          <img
            src={props.src}
            alt={typeof props.alt === 'string' ? props.alt : ''}
            style={{ maxWidth: '100%' }}
          />
        ) : null,
    },
  ],
}
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: unknown) {
    return { error: String(error) }
  }
  render() {
    return this.state.error ? (
      <p role="alert">Unsupported legacy UI: {this.state.error}</p>
    ) : (
      this.props.children
    )
  }
}
