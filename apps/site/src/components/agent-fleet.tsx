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
      'Let separate threads move at the same time. Your API, interface, review and delivery each have an agent, their own context and a separate checkout.',
    count: '4 threads running simultaneously',
    event: [
      'Start four independent threads',
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
    count: '4 threads · 12 subagents',
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
      'Coming soon: experimental agent orchestration across your laptop, build server, remote workstation and test runner. Agents will hand off work and exchange findings between paired runtimes. Connecting to multiple runtimes is available today.',
    count: 'Coming soon · 4 runtimes · 64 agents',
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
  {
    name: 'Do',
    title: 'One goal. Do leads the fleet.',
    description:
      'Coming soon: give Do your goal. The Do agent plans the work, coordinates a possible fleet of 256 agents across your runtimes, gathers their findings and coordinates the next steps. You keep the direction and final approval.',
    count: 'Coming soon · Do + 256 possible agents',
    event: [
      'You give Do the goal',
      'Do breaks the goal into focused work',
      'Do dispatches agents across runtimes',
      'Agents delegate implementation and checks',
      'Findings return to Do',
      'Do coordinates the next steps',
      'You review what ships',
    ],
  },
] as const

const threads = [
  {
    name: 'API thread',
    agent: 'API agent',
    task: 'Build the endpoint',
    file: 'api/routes.ts',
    children: ['Research', 'Implement', 'Tests'],
  },
  {
    name: 'UI thread',
    agent: 'UI agent',
    task: 'Build the interface',
    file: 'app/dashboard.tsx',
    children: ['Components', 'Styles', 'A11y'],
  },
  {
    name: 'Review thread',
    agent: 'Review agent',
    task: 'Review the changes',
    file: 'pull-request.diff',
    children: ['Diff review', 'Types', 'Security'],
  },
  {
    name: 'Delivery thread',
    agent: 'Delivery agent',
    task: 'Prepare the release',
    file: 'release/workflow.yml',
    children: ['Build', 'Checks', 'Docs'],
  },
] as const
const runtimes = [
  {
    name: 'Your laptop',
    detail: 'LOCAL / PLAN + IMPLEMENT',
    tasks: [
      'Map the requirements',
      'Build the dashboard',
      'Inspect the changes',
      'Prepare the handoff',
    ],
  },
  {
    name: 'Build server',
    detail: 'REMOTE / BUILD + VALIDATE',
    tasks: [
      'Compile the API',
      'Bundle the interface',
      'Check the types',
      'Build release artifacts',
    ],
  },
  {
    name: 'Remote workstation',
    detail: 'REMOTE / RESEARCH + REVIEW',
    tasks: ['Review the contract', 'Check accessibility', 'Audit the changes', 'Update the docs'],
  },
  {
    name: 'Test runner',
    detail: 'REMOTE / TEST + REPORT',
    tasks: ['Run API tests', 'Run browser tests', 'Verify the migration', 'Report the results'],
  },
] as const
const activities = [
  'Reading project context',
  'Editing implementation',
  'Running targeted tests',
  'Reviewing the diff',
  'Sending findings',
  'Applying feedback',
  'Preparing handoff',
]
const fleetSize = [1, 4, 16, 64, 256]

function FleetThread({
  index,
  runtime,
  stage,
  beat,
}: {
  index: number
  runtime: number
  stage: number
  beat: number
}) {
  const thread = threads[index]
  const sequence = runtime * 4 + index
  const progress = 16 + ((beat * 11 + sequence * 17) % 80)
  return (
    <div className="fleet-thread" style={{ animationDelay: `${sequence * 45}ms` }}>
      <div className="fleet-agent">
        <div className="fleet-agent-heading">
          <span className="fleet-agent-mark" aria-hidden="true">
            ✳
          </span>
          <strong>
            {stage === 3 && runtime === 0 && index === 0 ? 'Lead agent' : thread.agent}
          </strong>
          <span className="fleet-node-status">● WORKING</span>
        </div>
        <p>
          {stage >= 3
            ? runtimes[runtime].tasks[index]
            : stage === 0
              ? thread.task
              : activities[(beat + sequence) % activities.length]}
        </p>
        <div className="fleet-agent-file">
          <span>{thread.file}</span>
          <span>{progress}%</span>
        </div>
        <div className="fleet-task-progress" aria-hidden="true">
          <i style={{ width: `${progress}%` }} />
        </div>
      </div>
      {stage >= 2 && (
        <div className="fleet-subagents expanded">
          <span className="fleet-delegation">
            ↓ delegate <span>↑ return findings</span>
          </span>
          <div>
            {thread.children.map((child, childIndex) => (
              <div
                className="fleet-child"
                key={child}
                style={{ animationDelay: `${(sequence * 3 + childIndex) * 35}ms` }}
              >
                <div>
                  <span className="fleet-child-light" aria-hidden="true" />
                  <strong>{child}</strong>
                </div>
                <small>
                  {
                    ['Reading', 'Editing', 'Testing', 'Reporting'][
                      (beat + sequence + childIndex) % 4
                    ]
                  }
                </small>
                <div className="fleet-work-bars" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                {stage === 4 && (
                  <div className="fleet-nested-team" aria-label="Four nested agents">
                    <span>↓ 4 agents</span>
                    <div>
                      {Array.from({ length: 4 }, (_, worker) => (
                        <i
                          className="fleet-worker"
                          key={worker}
                          style={{
                            animationDelay: `${-(sequence * 4 + childIndex + worker) * 0.17}s`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MobileFleet({ stage, beat, running }: { stage: number; beat: number; running: boolean }) {
  const groups = stage === 0 ? 1 : 4
  const offset = stage === 4 ? 60 : 0
  const paths =
    stage === 0
      ? ['M180 46V125']
      : stage === 4
        ? [
            'M180 46V66',
            'M180 106V124H88V146',
            'M180 124H272V146',
            'M88 290V314',
            'M272 290V314',
            'M164 216H196',
            'M164 384H196',
            'M164 276L196 326',
            'M196 276L164 326',
          ]
        : [
            'M180 46V64H88V86',
            'M180 64H272V86',
            ...(stage === 3
              ? ['M88 230V254', 'M272 230V254']
              : ['M180 64V242H88V254', 'M180 242H272V254']),
            ...(stage === 3
              ? ['M164 156H196', 'M164 324H196', 'M164 216L196 266', 'M196 216L164 266']
              : []),
          ]
  return (
    <div className="fleet-mobile-flow" aria-hidden="true" data-agents={fleetSize[stage]}>
      <svg viewBox={stage === 4 ? '0 0 360 480' : '0 0 360 420'} fill="none">
        <defs>
          <marker
            id="fleet-mobile-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="m2 2 6 3-6 3" stroke="#7cc9ff" />
          </marker>
        </defs>
        <rect x="133" y="10" width="94" height="36" rx="7" fill="#102432" stroke="#7cc9ff77" />
        <text x="180" y="33" textAnchor="middle" className="mobile-flow-you">
          YOU
        </text>
        {stage === 4 && (
          <g className="mobile-dovo-orchestrator">
            <rect x="110" y="66" width="140" height="40" rx="8" fill="#19394d" stroke="#bcefff" />
            <circle className="mobile-do-node orchestrator" cx="127" cy="86" r="5" fill="#bcefff" />
            <text x="180" y="84" textAnchor="middle" className="mobile-flow-you">
              DO
            </text>
            <text x="180" y="98" textAnchor="middle" className="mobile-flow-detail">
              Plan · Coordinate
            </text>
          </g>
        )}
        {paths.map((path, index) => (
          <g key={path}>
            <path d={path} className="fleet-link" markerEnd="url(#fleet-mobile-arrow)" />
            {running && (
              <circle r="3" fill="#bcefff">
                <animateMotion
                  dur={`${1.2 + index * 0.15}s`}
                  repeatCount="indefinite"
                  path={path}
                />
              </circle>
            )}
          </g>
        ))}
        {Array.from({ length: groups }, (_, index) => {
          const x = stage === 0 ? 80 : index % 2 === 0 ? 12 : 196
          const y = (stage === 0 ? 125 : index < 2 ? 86 : 254) + offset
          const width = stage === 0 ? 200 : 152
          const label =
            stage >= 3
              ? ['Your laptop', 'Build server', 'Workstation', 'Test runner'][index]
              : stage === 0
                ? threads[beat < 3 ? 0 : beat < 5 ? 1 : 2].agent
                : ['API', 'Interface', 'Review', 'Delivery'][index]
          return (
            <g key={`${stage}-${index}`} transform={`translate(${x} ${y})`}>
              <rect width={width} height="144" rx="9" fill="#101923" stroke="#7cc9ff44" />
              <text x="12" y="23" className="mobile-flow-label">
                {label}
              </text>
              {stage >= 3 ? (
                <>
                  <path d="M26 56V120M59 56V120M92 56V120M125 56V120" stroke="#7cc9ff33" />
                  {Array.from({ length: stage === 4 ? 64 : 16 }, (_, node) => (
                    <circle
                      key={node}
                      className={`mobile-fleet-node ${stage === 4 ? (node % 16 === 0 ? 'parent' : 'child') : node < 4 ? 'parent' : 'child'}`}
                      cx={
                        stage === 4
                          ? 17 + (Math.floor(node / 16) % 2) * 70 + (node % 4) * 14
                          : 26 + (node % 4) * 33
                      }
                      cy={
                        stage === 4
                          ? 46 + Math.floor(node / 32) * 42 + Math.floor((node % 16) / 4) * 10
                          : 56 + Math.floor(node / 4) * 21
                      }
                      r={stage === 4 ? (node % 16 === 0 ? 3.5 : 2.5) : node < 4 ? 6 : 4}
                      style={{ animationDelay: `${-(node + index) * 0.13}s` }}
                    />
                  ))}
                  <text x="12" y="137" className="mobile-flow-detail">
                    {stage === 4 ? '64 agents / runtime' : '4 threads + 12 subagents'}
                  </text>
                </>
              ) : (
                <>
                  <circle className="mobile-fleet-node parent" cx={width / 2} cy="57" r="9" />
                  {stage === 2 && (
                    <>
                      <path
                        d="M76 66V78M40 78H112M40 78V94M76 78V94M112 78V94"
                        stroke="#7cc9ff55"
                      />
                      {[40, 76, 112].map((cx, node) => (
                        <circle
                          className="mobile-fleet-node child"
                          key={cx}
                          cx={cx}
                          cy="99"
                          r="5"
                          style={{ animationDelay: `${-(node + index) * 0.2}s` }}
                        />
                      ))}
                    </>
                  )}
                  <text
                    x={width / 2}
                    y={stage === 2 ? 128 : 95}
                    textAnchor="middle"
                    className="mobile-flow-detail"
                  >
                    {stage === 0
                      ? 'One thread at a time'
                      : stage === 1
                        ? activities[(beat + index) % activities.length]
                            .split(' ')
                            .slice(0, 2)
                            .join(' ')
                        : 'Delegate ↓ Results ↑'}
                  </text>
                </>
              )}
            </g>
          )
        })}
        <text x="180" y={415 + offset} textAnchor="middle" className="mobile-flow-detail">
          {stage === 4
            ? 'Your goal → Do → Fleet → Your review'
            : stage === 3
              ? 'Brief → Build → Test → Review → Handoff'
              : stage === 2
                ? 'Four threads. Twelve focused subagents.'
                : stage === 1
                  ? 'Four independent threads working together.'
                  : 'Start with an idea. Keep the direction.'}
        </text>
      </svg>
      <div className="mobile-flow-legend">
        <span>
          <i />
          Thread agent
        </span>
        {stage >= 2 && (
          <span>
            <i />
            Subagent
          </span>
        )}
        <span>→ {stage === 4 ? 'Do coordinates' : stage === 3 ? 'Handoffs' : 'Direction'}</span>
      </div>
    </div>
  )
}

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
  const runtimeCount = stage >= 3 ? 4 : 1

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncPreference = () => setReduced(preference.matches)
    const syncVisibility = () => setForeground(!document.hidden)
    syncPreference()
    syncVisibility()
    preference.addEventListener('change', syncPreference)
    document.addEventListener('visibilitychange', syncVisibility)
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.01,
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
              {index >= 3 && <small className="fleet-soon">Soon</small>}
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
            {stage >= 3 && (
              <span className="fleet-future">
                {stage === 4
                  ? 'Coming soon · Do fleet orchestration'
                  : 'Coming soon · Experimental cross-runtime orchestration'}
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
          <div className="fleet-scene-top">
            <div className="fleet-you">
              <span className="status-dot" /> YOU <span>Direction · Decisions · Final review</span>
            </div>
            <div className="fleet-scale">
              <strong>{fleetSize[stage]}</strong>
              <span>
                {stage === 4 ? 'possible agents' : `active ${stage === 0 ? 'agent' : 'agents'}`}
                <small>{stage === 4 ? '1 → 4 → 16 → 64 → 256' : '1 → 4 → 16 → 64'}</small>
              </span>
            </div>
          </div>
          <MobileFleet stage={stage} beat={beat} running={running} />
          <div className="fleet-diagram">
            {stage === 4 && (
              <div className="fleet-dovo-orchestrator">
                <span className="status-dot" />
                <div>
                  <strong>Do</strong>
                  <small>Plan the work · Delegate across runtimes · Gather findings</small>
                </div>
                <span className="fleet-dovo-status">
                  {
                    [
                      'Planning',
                      'Delegating',
                      'Coordinating',
                      'Reviewing findings',
                      'Routing feedback',
                      'Assembling results',
                      'Awaiting your review',
                    ][beat]
                  }
                </span>
              </div>
            )}
            {stage >= 3 && (
              <svg
                className="fleet-connections"
                viewBox="0 0 1400 800"
                preserveAspectRatio="none"
                fill="none"
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="fleet-arrow"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path d="m2 2 6 3-6 3" fill="none" stroke="#7cc9ff" />
                  </marker>
                </defs>
                {[
                  ...(stage === 4 ? ['M700 60V105H350V155', 'M700 105H1050V155'] : []),
                  'M620 190H780',
                  'M620 610H780',
                  'M350 360V440',
                  'M1050 360V440',
                  'M620 320L780 480',
                  'M780 320L620 480',
                ].map((path, index) => (
                  <g key={path}>
                    <path
                      className="fleet-link fleet-exchange"
                      d={path}
                      markerEnd="url(#fleet-arrow)"
                    />
                    {running && (
                      <>
                        <circle r="4" fill="#7cc9ff">
                          <animateMotion
                            dur={`${1.6 + index * 0.25}s`}
                            repeatCount="indefinite"
                            path={path}
                          />
                        </circle>
                        <circle r="2.5" fill="#ededed">
                          <animateMotion
                            dur={`${2.3 + index * 0.3}s`}
                            begin="-.9s"
                            repeatCount="indefinite"
                            path={path}
                          />
                        </circle>
                      </>
                    )}
                  </g>
                ))}
              </svg>
            )}
            <div className="fleet-runtime-grid">
              {runtimes.slice(0, runtimeCount).map((runtime, runtimeIndex) => (
                <div
                  className="fleet-runtime active"
                  key={runtime.name}
                  style={{ animationDelay: `${runtimeIndex * 150}ms` }}
                >
                  <div className="fleet-runtime-header">
                    <div>
                      <span className="status-dot" />
                      <strong>{runtime.name}</strong>
                      <small>{runtime.detail}</small>
                    </div>
                    <span>
                      {stage === 0
                        ? '01'
                        : stage >= 3
                          ? stage === 4
                            ? '64'
                            : '16'
                          : String(fleetSize[stage]).padStart(2, '0')}{' '}
                      AGENTS
                    </span>
                  </div>
                  <div className="fleet-thread-grid">
                    {(stage === 0 ? [activeThread] : [0, 1, 2, 3]).map((index) => (
                      <FleetThread
                        key={index}
                        index={index}
                        runtime={runtimeIndex}
                        stage={stage}
                        beat={beat}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="fleet-handoff-label">
              {stage === 4
                ? 'YOU SET THE GOAL → DO COORDINATES → THE FLEET EXECUTES'
                : stage === 3
                  ? 'BRIEF → DELEGATE → BUILD → TEST → REVIEW → HAND OFF'
                  : stage >= 2
                    ? 'FOCUSED SUBTASKS. SIMULTANEOUS PROGRESS.'
                    : 'EVERY THREAD HAS ITS OWN CONTEXT.'}
            </div>
          </div>
          <div className="fleet-activity" aria-hidden="true">
            <div className="fleet-activity-title">
              <span className="status-dot" /> FLEET ACTIVITY <small>Illustrated</small>
            </div>
            <div className="fleet-activity-stream" key={`${stage}-${beat}`}>
              {Array.from({ length: stage === 0 ? 1 : stage === 1 ? 3 : 5 }, (_, index) => (
                <div key={index}>
                  <span>+{String(beat * 3 + index).padStart(2, '0')}s</span>
                  <strong>
                    {stage >= 3 ? runtimes[index % 4].name : threads[(beat + index) % 4].agent}
                  </strong>
                  <span>{activities[(beat + index * 2) % activities.length]}</span>
                  <i>●</i>
                </div>
              ))}
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
        </p>
      </div>
    </section>
  )
}
