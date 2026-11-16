import { createContext, useContext, useId } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@dovo/studio-ui/mcp-app-sdk'
import { A2uiSurface, createComponentImplementation, type ReactCatalogComponent } from '@a2ui/react'
import {
  Catalog,
  type MessageProcessor,
  type ActionPayload,
  type ResolvedChildRef,
} from '@a2ui/web_core'
import {
  A2UI_CATALOG_ID,
  a2uiApis,
  a2uiApplyValues,
  a2uiInputValues,
  a2uiProcessor,
  a2uiStateSchema,
  type A2uiState,
} from '@dovo/protocol/a2ui'

const app = new App({ name: 'Dovo A2UI', version: '1.0.0' }, {})
const disabledContext = createContext(false)
const implementations = [
  createComponentImplementation(a2uiApis.Text, ({ props }) =>
    props.variant === 'heading' ? (
      <h2>{props.text}</h2>
    ) : (
      <p className={props.variant === 'caption' ? 'caption' : undefined}>{props.text}</p>
    ),
  ),
  ...(['Column', 'Row', 'List'] as const).map((name) =>
    createComponentImplementation(a2uiApis[name], ({ props, buildChild }) => (
      <div className={name.toLowerCase()} role={name === 'List' ? 'list' : undefined}>
        {props.children.map((child: string | ResolvedChildRef) => (
          <div
            key={typeof child === 'string' ? child : `${child.id}:${child.basePath}`}
            role={name === 'List' ? 'listitem' : undefined}
          >
            {typeof child === 'string' ? buildChild(child) : buildChild(child.id, child.basePath)}
          </div>
        ))}
      </div>
    )),
  ),
  createComponentImplementation(a2uiApis.Card, ({ props, buildChild }) => (
    <section className="card">{buildChild(props.child)}</section>
  )),
  createComponentImplementation(a2uiApis.Divider, () => <hr />),
  createComponentImplementation(a2uiApis.TextField, ({ props }) => {
    const disabled = useContext(disabledContext)
    return (
      <label className="field">
        <span>
          {props.label}
          {props.required ? ' *' : ''}
        </span>
        {props.multiline ? (
          <textarea
            value={props.value ?? ''}
            required={props.required}
            disabled={disabled}
            maxLength={4000}
            onChange={(event) => props.setValue(event.target.value)}
          />
        ) : (
          <input
            value={props.value ?? ''}
            required={props.required}
            disabled={disabled}
            maxLength={4000}
            onChange={(event) => props.setValue(event.target.value)}
          />
        )}
      </label>
    )
  }),
  createComponentImplementation(a2uiApis.CheckBox, ({ props }) => {
    const disabled = useContext(disabledContext)
    return (
      <label className="check">
        <input
          type="checkbox"
          checked={props.value ?? false}
          disabled={disabled}
          onChange={(event) => props.setValue(event.target.checked)}
        />
        <span>{props.label}</span>
      </label>
    )
  }),
  createComponentImplementation(a2uiApis.ChoicePicker, ({ props }) => {
    const name = useId()
    const disabled = useContext(disabledContext)
    return (
      <fieldset className="choices" disabled={disabled}>
        <legend>
          {props.label}
          {props.required ? ' *' : ''}
        </legend>
        {props.options.map((option) => (
          <label className="check" key={option.value}>
            <input
              type={props.multiple ? 'checkbox' : 'radio'}
              name={name}
              value={option.value}
              checked={props.value?.includes(option.value) ?? false}
              onChange={(event) =>
                props.setValue(
                  props.multiple
                    ? event.target.checked
                      ? [...(props.value ?? []), option.value]
                      : (props.value ?? []).filter((item) => item !== option.value)
                    : [option.value],
                )
              }
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    )
  }),
  createComponentImplementation(a2uiApis.Button, ({ props }) => {
    const disabled = useContext(disabledContext)
    return (
      <button
        disabled={disabled}
        onClick={() => {
          void props.action().catch(fail)
        }}
      >
        {props.label}
      </button>
    )
  }),
]
const catalog = new Catalog<ReactCatalogComponent>(A2UI_CATALOG_ID, '1.0', implementations)
const root = createRoot(document.getElementById('root')!)
let state: A2uiState | undefined
let processor: MessageProcessor<ReactCatalogComponent> | undefined
let subscriptions: Array<{ unsubscribe: () => void }> = []
let busy = false
let loading = false
let stale = false
let error = ''
let notice = ''
let dirty = false
let saving: Promise<void> = Promise.resolve()
let saveFailed = false
let replaceRequested = false

function render() {
  root.render(
    <main>
      <p className="caption">Interactive card · Dovo A2UI</p>
      <disabledContext.Provider value={busy || loading || !!state?.submitted || !!state?.readOnly}>
        {processor &&
          [...processor.model.surfacesMap.values()].map((surface) => (
            <A2uiSurface key={surface.id} surface={surface} />
          ))}
      </disabledContext.Provider>
      {busy && <p role="status">Waiting for approval…</p>}
      {state?.submitted && (
        <p role="status">
          {state.delivery === 'sent'
            ? 'Response sent to the thread.'
            : 'Delivery is unconfirmed. Check the thread before sending another response.'}
        </p>
      )}
      {notice && (
        <p role="status" className="caption">
          {notice}
        </p>
      )}
      {state?.readOnly && <p className="caption">This thread is read-only.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="footer">
        <button
          className="secondary"
          disabled={busy || loading}
          onClick={() => {
            void refresh().catch(fail)
          }}
        >
          {stale ? 'Load current card and replace this input' : 'Refresh card'}
        </button>
        {saveFailed && (
          <button
            className="secondary"
            disabled={busy || loading}
            onClick={() => {
              void retrySave().catch(fail)
            }}
          >
            Retry saving draft
          </button>
        )}
      </div>
      {replaceRequested && (
        <div role="group" aria-label="Replace local input">
          <p>Load the current card? This replaces the input shown here.</p>
          <button
            onClick={() => {
              replaceRequested = false
              void refresh(true).catch(fail)
            }}
          >
            Replace input
          </button>
          <button
            className="secondary"
            onClick={() => {
              replaceRequested = false
              render()
            }}
          >
            Keep input
          </button>
        </div>
      )}
    </main>,
  )
}
function fail(cause: unknown) {
  error = cause instanceof Error ? cause.message : String(cause)
  render()
}
function load(input: unknown) {
  const next = a2uiStateSchema.parse(input)
  const nextProcessor = a2uiProcessor(next.messages, catalog, submit)
  try {
    a2uiApplyValues(nextProcessor, next.values)
  } catch (cause) {
    nextProcessor.dispose()
    throw cause
  }
  subscriptions.forEach((subscription) => subscription.unsubscribe())
  processor?.dispose()
  state = next
  processor = nextProcessor
  stale = false
  saveFailed = false
  dirty = false
  error = ''
  notice = ''
  replaceRequested = false
  subscriptions = [...processor.model.surfacesMap.values()].map((surface) =>
    surface.dataModel.subscribe('/', () => {
      if (!state?.submitted) {
        dirty = true
        notice = ''
        render()
        persist()
      }
    }),
  )
  render()
}
function persist() {
  saving = saving
    .then(async () => {
      while (dirty && !saveFailed && state && processor) {
        dirty = false
        const values = a2uiInputValues(processor)
        await app.updateModelContext({
          structuredContent: { revision: state.revision, draftVersion: state.draftVersion, values },
        })
        state = { ...state, draftVersion: state.draftVersion + 1, values }
        notice = 'Draft saved on the computer.'
        render()
      }
    })
    .catch((cause: unknown) => {
      saveFailed = true
      stale = true
      notice = ''
      fail(cause)
    })
}
async function refresh(replace = false) {
  if (loading || busy) return
  loading = true
  render()
  try {
    await saving
    if ((dirty || saveFailed) && !replace) {
      replaceRequested = true
      return
    }
    const response = await app.callServerTool({ name: 'a2ui_read', arguments: {} })
    load(response.structuredContent)
  } finally {
    loading = false
    render()
  }
}
async function retrySave() {
  if (!state || !processor || loading || busy) return
  loading = true
  render()
  try {
    const response = await app.callServerTool({ name: 'a2ui_read', arguments: {} })
    const latest = a2uiStateSchema.parse(response.structuredContent)
    const local = a2uiInputValues(processor)
    if (latest.revision !== state.revision || latest.submitted)
      throw new Error(
        'The card changed. Your input is still shown. Load the current card to replace it.',
      )
    if (JSON.stringify(latest.values) === JSON.stringify(local)) {
      state = latest
      saveFailed = false
      stale = false
      dirty = false
      error = ''
      notice = 'Draft saved on the computer.'
      return
    }
    if (latest.draftVersion !== state.draftVersion)
      throw new Error('Another device changed the draft. Your input is still shown.')
    saveFailed = false
    stale = false
    dirty = true
    error = ''
    persist()
    await saving
  } finally {
    loading = false
    render()
  }
}
async function submit(event: ActionPayload) {
  if (!state || !processor || busy || loading || state.submitted) return
  if (stale) {
    fail(new Error('Refresh the card before submitting. Your input is still shown.'))
    return
  }
  busy = true
  error = ''
  notice = ''
  render()
  try {
    await saving
    if (saveFailed)
      throw new Error(
        'The draft could not be saved. Your input is still shown. Refresh before submitting.',
      )
    const response = await app.callServerTool({
      name: 'a2ui_submit',
      arguments: {
        revision: state.revision,
        draftVersion: state.draftVersion,
        values: a2uiInputValues(processor),
        surfaceId: event.surfaceId,
        sourceComponentId: event.sourceComponentId,
      },
    })
    if (response.isError)
      throw new Error(
        response.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n'),
      )
    load(response.structuredContent)
  } catch (cause) {
    fail(cause)
  } finally {
    busy = false
    render()
  }
}

app.ontoolresult = (response) => {
  try {
    load(response.structuredContent)
  } catch (cause) {
    fail(cause)
  }
}
app.onhostcontextchanged = (context) => {
  if (context.theme) document.documentElement.dataset.theme = context.theme
}
app.onteardown = async () => {
  await saving
  subscriptions.forEach((subscription) => subscription.unsubscribe())
  processor?.dispose()
  return {}
}
void app
  .connect()
  .then(() => {
    document.documentElement.dataset.theme = app.getHostContext()?.theme ?? 'light'
    render()
  })
  .catch(fail)
