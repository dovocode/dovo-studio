import { createComponentImplementation } from '@a2ui/react'
import { a2uiApis } from '@dovo/protocol/a2ui'

export const evidenceComponents = [
  createComponentImplementation(a2uiApis.Diff, ({ props }) => (
    <figure className="diff">
      <figcaption>{props.label}</figcaption>
      <div className="diff-scroll" role="region" aria-label={props.label} tabIndex={0}>
        <table className="diff-lines">
          <thead>
            <tr>
              <th scope="col">Old</th>
              <th scope="col">New</th>
              <th scope="col">Change</th>
              <th scope="col">Code</th>
            </tr>
          </thead>
          {props.hunks.map((hunk, index) => {
            let oldLine = hunk.oldStart
            let newLine = hunk.newStart
            return (
              <tbody key={index}>
                {hunk.lines.map(({ kind, text }, index) => (
                  <tr key={index} data-change={kind}>
                    <td>{kind === 'add' ? '' : oldLine++}</td>
                    <td>{kind === 'delete' ? '' : newLine++}</td>
                    <td>
                      <span aria-hidden="true">
                        {kind === 'add' ? '+' : kind === 'delete' ? '−' : ' '}
                      </span>
                      <span className="visually-hidden">
                        {kind === 'add' ? 'Added' : kind === 'delete' ? 'Removed' : 'Context'}
                      </span>
                    </td>
                    <td>
                      <code>{text}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            )
          })}
        </table>
      </div>
    </figure>
  )),
  createComponentImplementation(a2uiApis.Timeline, ({ props }) => (
    <section className="timeline" aria-label={props.label}>
      <h2>{props.label}</h2>
      <ol role="list">
        {props.items.map((item) => (
          <li key={item.id} data-tone={item.tone ?? 'neutral'}>
            <div className="timeline-heading">
              <strong>{item.title}</strong>
              {item.status && (
                <span className="badge" data-tone={item.tone ?? 'neutral'}>
                  {item.status}
                </span>
              )}
              {item.time && (
                <time className="caption" dateTime={item.time}>
                  {item.time.replace('T', ' ')}
                </time>
              )}
            </div>
            {item.detail && <p>{item.detail}</p>}
          </li>
        ))}
      </ol>
    </section>
  )),
]
