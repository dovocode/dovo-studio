'use client'

import { useState } from 'react'
import { WorkspaceScreenshot } from './workspace-screenshots'

const views = [
  {
    name: 'Agent workspace',
    label: 'A home for every “what if”.',
    description:
      'Give each idea its own thread. Follow your agents as they work, answer questions and keep the conversation connected to your project.',
    points: [
      'Streamed agent conversations',
      'Questions and approvals in context',
      'Projects, threads and follow-ups',
    ],
  },
  {
    name: 'Code & review',
    label: 'Stay in the loop. All the way to ship.',
    description:
      'Keep the code close to the conversation. Work with branches and worktrees, inspect changes and browse pull requests without scattering your context.',
    points: [
      'Branches and isolated worktrees',
      'Diffs and pull requests',
      'A real terminal on your host',
    ],
  },
  {
    name: 'Automations',
    label: 'Make your good workflows repeatable.',
    description:
      'Connect schedules, webhooks and agent tasks in a visual editor. Add human review where your workflow needs a decision.',
    points: ['Schedules and webhook triggers', 'Agent tasks and task runs', 'Human review steps'],
  },
] as const

export function ProductTour() {
  const [selected, setSelected] = useState(0)
  const view = views[selected]
  return (
    <section className="product-tour" id="product" aria-label="Explore the product">
      <div className="tour-tabs" role="group" aria-label="Product features">
        {views.map((item, index) => (
          <button
            type="button"
            key={item.name}
            aria-pressed={selected === index}
            aria-controls="tour-content"
            onClick={() => setSelected(index)}
          >
            <span aria-hidden="true">0{index + 1}</span> {item.name}
          </button>
        ))}
      </div>
      <div className="tour-content" id="tour-content">
        <div className="tour-copy" aria-live="polite">
          <p className="eyebrow">IN YOUR ELEMENT</p>
          <h3>{view.label}</h3>
          <p>{view.description}</p>
          <ul>
            {view.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <a className="text-link" href="/docs/">
            Explore the docs ↗
          </a>
        </div>
        <WorkspaceScreenshot automation={selected === 2} />
      </div>
    </section>
  )
}
