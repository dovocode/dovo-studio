import { Fragment, createContext, useContext, useId, useState } from 'react'
import { createComponentImplementation } from '@a2ui/react'
import { a2uiApis } from '@dovo/protocol/a2ui'
import { evidenceComponents } from './evidence-components'

export const disabledContext = createContext(false)

// Navigation, filtering and sorting stay local. Only declared input bindings become drafts.
export const workbenchComponents = [
  ...evidenceComponents,
  createComponentImplementation(a2uiApis.Badge, ({ props }) => (
    <span className="badge" data-tone={props.tone ?? 'neutral'}>
      {props.text}
    </span>
  )),
  createComponentImplementation(a2uiApis.Callout, ({ props }) => (
    <aside className="callout" data-tone={props.tone ?? 'info'}>
      <strong>{props.title}</strong>
      <p>{props.text}</p>
    </aside>
  )),
  createComponentImplementation(a2uiApis.Metric, ({ props }) => (
    <section className="metric" aria-label={props.label} data-tone={props.tone ?? 'neutral'}>
      <span className="caption">{props.label}</span>
      <strong>{props.value}</strong>
      {props.detail && <p className="caption">{props.detail}</p>}
    </section>
  )),
  createComponentImplementation(a2uiApis.Progress, ({ props }) => (
    <label className="field progress">
      <span>
        {props.label}
        <span className="caption">
          {' '}
          {props.value ?? 0} / {props.max}
        </span>
      </span>
      <progress value={props.value ?? 0} max={props.max} />
    </label>
  )),
  createComponentImplementation(a2uiApis.CodeBlock, ({ props }) => (
    <figure className="code-block">
      {props.language && <figcaption>{props.language}</figcaption>}
      <pre tabIndex={0}>
        <code>{props.code}</code>
      </pre>
    </figure>
  )),
  createComponentImplementation(a2uiApis.Tabs, ({ props, buildChild }) => {
    const id = useId()
    const [selected, setSelected] = useState(0)
    const active = selected < props.tabs.length ? selected : 0
    return (
      <section className="tabs">
        <div role="tablist" aria-label={props.label}>
          {props.tabs.map((tab, index) => (
            <button
              key={tab.child}
              type="button"
              role="tab"
              id={`${id}-tab-${index}`}
              aria-selected={index === active}
              aria-controls={`${id}-panel-${index}`}
              tabIndex={index === active ? 0 : -1}
              onClick={() => setSelected(index)}
              onKeyDown={(event) => {
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? props.tabs.length - 1
                      : event.key === 'ArrowRight'
                        ? (index + 1) % props.tabs.length
                        : event.key === 'ArrowLeft'
                          ? (index + props.tabs.length - 1) % props.tabs.length
                          : undefined
                if (next === undefined) return
                event.preventDefault()
                setSelected(next)
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                  [next]?.focus()
              }}
            >
              {tab.title}
            </button>
          ))}
        </div>
        {props.tabs.map((tab, index) => (
          <div
            key={tab.child}
            role="tabpanel"
            id={`${id}-panel-${index}`}
            aria-labelledby={`${id}-tab-${index}`}
            hidden={index !== active}
            tabIndex={0}
          >
            {buildChild(tab.child)}
          </div>
        ))}
      </section>
    )
  }),
  createComponentImplementation(a2uiApis.Disclosure, ({ props, buildChild }) => (
    <details className="disclosure" open={props.open}>
      <summary>{props.title}</summary>
      <div>{buildChild(props.child)}</div>
    </details>
  )),
  createComponentImplementation(a2uiApis.NumberField, ({ props, context }) => {
    const disabled = useContext(disabledContext)
    const id = useId()
    const hint = [
      props.min !== undefined && `Minimum ${props.min}`,
      props.max !== undefined && `Maximum ${props.max}`,
      props.step !== undefined && `Step ${props.step}`,
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      <label className="field">
        <span>
          {props.label}
          {props.required ? ' *' : ''}
        </span>
        <input
          type="number"
          inputMode="decimal"
          value={props.value ?? ''}
          disabled={disabled}
          min={props.min}
          max={props.max}
          step={props.step ?? 'any'}
          required={props.required}
          aria-describedby={hint ? id : undefined}
          onChange={(event) => {
            const value = event.target.valueAsNumber
            if (Number.isFinite(value)) props.setValue(value)
            else {
              const { value: bound } = a2uiApis.NumberField.schema.parse(
                context.componentModel.properties,
              )
              if (bound && typeof bound === 'object') context.dataContext.set(bound['@path'], null)
            }
          }}
        />
        {hint && (
          <span id={id} className="caption">
            {hint}
          </span>
        )}
      </label>
    )
  }),
  createComponentImplementation(a2uiApis.DataTable, ({ props, buildChild }) => {
    const disabled = useContext(disabledContext)
    const tableId = useId()
    const [query, setQuery] = useState('')
    const [sort, setSort] = useState<{ key: string; descending: boolean }>()
    const [openRow, setOpenRow] = useState<string>()
    const selectable = props.value !== undefined
    const multiple = props.multiple !== false
    const selected = props.value ?? []
    const rows = props.rows.filter((row) =>
      props.columns.some((column) =>
        String(row.cells[column.key] ?? '')
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      ),
    )
    if (sort)
      rows.sort((a, b) => {
        const first = a.cells[sort.key],
          second = b.cells[sort.key]
        const comparison =
          typeof first === 'number' && typeof second === 'number'
            ? first - second
            : String(first ?? '').localeCompare(String(second ?? ''), undefined, { numeric: true })
        return sort.descending ? -comparison : comparison
      })
    return (
      <section className="data-table" aria-label={props.label}>
        <div className="table-tools">
          <strong>
            {props.label}
            {props.required ? ' *' : ''}
          </strong>
          <span className="caption">
            {selectable && `${selected.length} selected · `}
            {rows.length} of {props.rows.length} rows
          </span>
          {props.searchable && (
            <input
              type="search"
              aria-label={`Filter ${props.label}`}
              placeholder="Filter rows"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
        </div>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label={`${props.label} table`}
        >
          <table
            className="table-grid"
            aria-label={props.label}
            data-compact={props.columns.length < 4}
          >
            <thead>
              <tr>
                {selectable && (
                  <th scope="col" className="table-selection">
                    Select
                  </th>
                )}
                {props.columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      sort?.key === column.key
                        ? sort.descending
                          ? 'descending'
                          : 'ascending'
                        : 'none'
                    }
                  >
                    <button
                      type="button"
                      className="sort-button"
                      aria-label={`Sort by ${column.label}`}
                      onClick={() =>
                        setSort({
                          key: column.key,
                          descending: sort?.key === column.key && !sort.descending,
                        })
                      }
                    >
                      {column.label}
                      {sort?.key === column.key ? (sort.descending ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const label = String(row.cells[props.columns[0].key] ?? row.id)
                const expanded = openRow === row.id
                const detailId = `${tableId}-row-${index}`
                return (
                  <Fragment key={row.id}>
                    <tr data-selected={selected.includes(row.id)}>
                      {selectable && (
                        <td className="table-selection">
                          <input
                            type={multiple ? 'checkbox' : 'radio'}
                            name={multiple ? undefined : tableId}
                            aria-label={`Select ${label}`}
                            checked={selected.includes(row.id)}
                            disabled={disabled}
                            onChange={(event) =>
                              props.setValue(
                                multiple
                                  ? event.target.checked
                                    ? [...selected, row.id]
                                    : selected.filter((id) => id !== row.id)
                                  : [row.id],
                              )
                            }
                          />
                        </td>
                      )}
                      {props.columns.map((column, columnIndex) => (
                        <td key={column.key}>
                          {columnIndex === 0 && row.detail ? (
                            <button
                              className="row-detail-toggle"
                              type="button"
                              aria-label={`Details for ${label || row.id}`}
                              aria-expanded={expanded}
                              aria-controls={expanded ? detailId : undefined}
                              onClick={() => setOpenRow(expanded ? undefined : row.id)}
                            >
                              <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                              {label || row.id}
                            </button>
                          ) : (
                            String(row.cells[column.key] ?? '')
                          )}
                        </td>
                      ))}
                    </tr>
                    {expanded && row.detail && (
                      <tr>
                        <td
                          className="table-detail"
                          colSpan={props.columns.length + Number(selectable)}
                        >
                          <div id={detailId}>{buildChild(row.detail)}</div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {!rows.length && <p className="empty-state">No rows match this filter.</p>}
        </div>
      </section>
    )
  }),
  createComponentImplementation(a2uiApis.BarChart, ({ props }) => {
    const maximum = Math.max(...props.items.map((item) => item.value), 1)
    return (
      <figure className="bar-chart" aria-label={props.label}>
        <figcaption>{props.label}</figcaption>
        <ul>
          {props.items.map((item, index) => (
            <li key={index}>
              <span>{item.label}</span>
              <strong>
                {item.value}
                {props.suffix ?? ''}
              </strong>
              <span className="bar-track" aria-hidden="true">
                <span style={{ width: `${(item.value / maximum) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      </figure>
    )
  }),
]
