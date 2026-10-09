'use client'

import { useEffect, useRef, useState } from 'react'

const stages = [
  {
    name: 'One thread at a time',
    title: 'Start with a conversation.',
    description:
      'One idea. One agent. Work through the API, then the interface, then the review — one thread at a time.',
    count: '1 active thread',
    event: [
      'Brief the API agent',
      'Build the API',
      'Review the API changes',
      'Hand off to the UI thread',
      'Build the interface',
      'Hand off to the review thread',
      'Review the final diff',
    ],
  },
  {
    name: 'Parallel threads',
    title: 'Give every idea room to run.',
    description:
      'Let separate threads move at the same time. Your API, interface and review each have an agent, their own context and a separate checkout.',
    count: '3 parallel threads',
    event: [
      'Start three independent threads',
      'API and UI work in parallel',
      'Review follows the changes',
      'Agents stream progress',
      'Keep each conversation in context',
      'Answer questions as they arrive',
      'Bring the work together',
    ],
  },
  {
    name: 'Threads + subagents',
    title: 'Build a team inside each thread.',
    description:
      'Agents delegate focused work to subagents. Research, implementation and tests can move together, with results flowing back to the parent.',
    count: '3 threads · 6 subagents',
    event: [
      'Parent agents break down the work',
      'Delegate focused subtasks',
      'Research and implementation run together',
      'Tests and checks follow',
      'Subagents send findings back',
      'Parent agents assemble the results',
      'Keep the whole team in view',
    ],
  },
  {
    name: 'Connected runtimes',
    title: 'One fleet. Multiple machines.',
    description:
      'Coming soon: experimental agent orchestration across your laptop, build server and remote workstation. Agents will hand off work and exchange findings between paired runtimes. Connecting to multiple runtimes is available today.',
    count: 'Coming soon · 3 runtimes',
    event: [
      'Connect the fleet across runtimes',
      'Laptop agent sends the build brief',
      'Build agent delegates implementation',
      'Review agent receives the changes',
      'Agents exchange findings',
      'Results return to the lead agent',
      'You review what ships',
    ],
  },
] as const

const threads = [
  {
    name: 'API thread',
    agent: 'API agent',
    task: 'Build the endpoint',
    children: ['Research', 'Tests'],
  },
  {
    name: 'UI thread',
    agent: 'UI agent',
    task: 'Build the interface',
    children: ['Components', 'Accessibility'],
  },
  {
    name: 'Review thread',
    agent: 'Review agent',
    task: 'Review the changes',
    children: ['Diff review', 'Checks'],
  },
] as const
const runtimes = ['Your laptop', 'Build server', 'Remote workstation']
const stageLength = 7

export function AgentFleet() {
  const root = useRef<HTMLElement>(null)
  const [tick, setTick] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [visible, setVisible] = useState(false)
  const [foreground, setForeground] = useState(true)
  const [reduced, setReduced] = useState(false)
  const stage = Math.floor(tick / stageLength)
  const beat = tick % stageLength
  const current = stages[stage]
  const running = playing && visible && foreground && !reduced
  const activeThread = beat < 3 ? 0 : beat < 5 ? 1 : 2

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncPreference = () => setReduced(preference.matches)
    const syncVisibility = () => setForeground(!document.hidden)
    syncPreference()
    syncVisibility()
    preference.addEventListener('change', syncPreference)
    document.addEventListener('visibilitychange', syncVisibility)
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.2,
    })
    if (root.current) observer.observe(root.current)
    return () => {
      observer.disconnect()
      preference.removeEventListener('change', syncPreference)
      document.removeEventListener('visibilitychange', syncVisibility)
    }
  }, [])

  useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(() => {
      setTick(tick + 1)
      if (tick + 1 === stages.length * stageLength - 1) setPlaying(false)
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [running, tick])

  return (
    <section
      className="fleet section wrap"
      ref={root}
      aria-labelledby="fleet-heading"
      data-stage={stage}
      data-running={running}
    >
      <div className="section-heading">
        <p className="eyebrow">FROM FIRST THREAD TO FULL FLEET</p>
        <h2 id="fleet-heading">
          Start small.
          <br />
          Think in fleets.
        </h2>
        <p>
          Your ambition grows. Your workspace grows with it. Follow the journey from a single
          conversation to a coordinated fleet.
        </p>
      </div>
      <noscript>
        <ol className="fleet-static">
          {stages.map((item) => (
            <li key={item.name}>
              <strong>{item.name}</strong>
              <p>{item.description}</p>
            </li>
          ))}
        </ol>
      </noscript>
      <div className="fleet-story">
        <div className="fleet-stages" role="group" aria-label="Fleet growth stages">
          {stages.map((item, index) => (
            <button
              type="button"
              key={item.name}
              aria-pressed={stage === index}
              aria-controls="fleet-scene"
              onClick={() => {
                setTick(index * stageLength)
                setPlaying(false)
              }}
            >
              <span>0{index + 1}</span>
              {item.name}
              {index === 3 && <small className="fleet-soon">Soon</small>}
              <i
                aria-hidden="true"
                className={index < stage ? 'complete' : ''}
                style={{
                  width:
                    index < stage
                      ? '100%'
                      : stage === index
                        ? `${((beat + 1) / stageLength) * 100}%`
                        : '0%',
                }}
              />
            </button>
          ))}
        </div>
        <div className="fleet-caption">
          <div>
            <p className="eyebrow">0{stage + 1} / FLEET EVOLUTION</p>
            <h3>{current.title}</h3>
            {stage === 3 && (
              <span className="fleet-future">
                Coming soon · Experimental cross-runtime orchestration
              </span>
            )}
            <p>{current.description}</p>
          </div>
          <div className="fleet-controls">
            {!reduced && (
              <button
                type="button"
                onClick={() => {
                  if (tick === stages.length * stageLength - 1) setTick(0)
                  setPlaying(!playing)
                }}
              >
                {playing ? 'Pause animation' : 'Play animation'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setTick(0)
                setPlaying(!reduced)
              }}
            >
              Replay from start
            </button>
          </div>
        </div>
        <div
          className="fleet-canvas"
          id="fleet-scene"
          role="img"
          tabIndex={0}
          aria-label={`${current.name}: ${current.description}`}
        >
          <div className="fleet-diagram">
            <div className="fleet-you">
              <span className="status-dot" /> YOU <span>Direction · Decisions · Final review</span>
            </div>
            <svg className="fleet-connections" viewBox="0 0 900 460" fill="none" aria-hidden="true">
              <path
                className="fleet-link"
                d="M450 58V112M150 112H750M150 112V170M450 112V170M750 112V170"
              />
              {stage === 3 && (
                <>
                  <path className="fleet-link fleet-exchange" d="M230 236H370M530 236H670" />
                  <path className="fleet-link fleet-return" d="M750 375V422H150V375" />
                  <text x="450" y="450" textAnchor="middle">
                    findings + handoffs → shared progress
                  </text>
                </>
              )}
            </svg>
            <div className="fleet-runtime-label">
              {stage === 3 ? 'CONNECTED FLEET / 3 RUNTIMES' : 'YOUR LAPTOP / LOCAL RUNTIME'}
            </div>
            <div className="fleet-columns">
              {threads.map((thread, index) => {
                const active = stage > 0 || activeThread === index
                const done = stage === 0 && index < activeThread
                return (
                  <div
                    className={`fleet-runtime ${active ? 'active' : ''} ${done ? 'done' : ''}`}
                    key={thread.name}
                  >
                    <div className="fleet-runtime-header">
                      <span aria-hidden="true">▣</span>
                      {stage === 3 ? runtimes[index] : thread.name}
                      <span className="fleet-runtime-status">
                        {active ? '●' : done ? '✓' : '○'}
                      </span>
                    </div>
                    <div className="fleet-agent">
                      <div className="fleet-agent-mark" aria-hidden="true">
                        ✳
                      </div>
                      <strong>{stage === 3 && index === 0 ? 'Lead agent' : thread.agent}</strong>
                      <small>
                        {active
                          ? stage === 3
                            ? ['Orchestrating', 'Building', 'Reviewing'][index]
                            : thread.task
                          : done
                            ? 'Complete · next thread'
                            : 'Queued · waiting its turn'}
                      </small>
                      <div className="fleet-work-bars" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </div>
                    </div>
                    <div className={`fleet-subagents ${stage >= 2 ? 'expanded' : ''}`}>
                      <span className="fleet-delegation">
                        ↓ delegate <span>↑ results</span>
                      </span>
                      <div>
                        {thread.children.map((child) => (
                          <div className="fleet-child" key={child}>
                            <span aria-hidden="true">↳</span>
                            <strong>{child}</strong>
                            <small>Subagent</small>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        <div className="fleet-footer">
          <span className="fleet-event">
            <span className="status-dot" />
            {current.event[beat]}
          </span>
          <span>{current.count}</span>
        </div>
        <p className="fleet-note">
          Illustrated workflow · Use the stages to explore at your own pace.
          <span className="fleet-pan-note"> Swipe the diagram to see the full fleet.</span>
        </p>
      </div>
    </section>
  )
}
