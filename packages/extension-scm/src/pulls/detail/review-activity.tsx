import { pullReviewActivity } from '@dovo/studio-core/pull-code-review'
import type { PullCodeReview } from '@dovo/protocol'
import { useAppPreferences } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'

const motion = `
@keyframes pr-review-flow { to { stroke-dashoffset: -48; } }
@keyframes pr-review-scan { 0%,100% { transform: translateY(-9px); opacity:.35 } 50% { transform: translateY(9px); opacity:1 } }
@keyframes pr-review-arrive { from { opacity:0; transform:translateY(5px) } to { opacity:1; transform:translateY(0) } }
.pr-review-motion { animation: pr-review-arrive 220ms ease-out both; }
.pr-review-motion .pr-flow { stroke-dasharray:3 9; animation:pr-review-flow 3s linear infinite; }
.pr-review-motion .pr-scan { animation:pr-review-scan 2.8s ease-in-out infinite; transform-box:fill-box; transform-origin:center; }
.pr-review-motion[data-reduced-motion=true], .pr-review-motion[data-reduced-motion=true] * { animation:none!important }
@media (prefers-reduced-motion:reduce) { .pr-review-motion,.pr-review-motion * { animation:none!important } }
`

export function ReviewActivity({
  review,
  reviewers = 1,
}: {
  review?: PullCodeReview
  reviewers?: number
}) {
  const uiText = useInterfaceText()
  const preferences = useAppPreferences()
  const { phase, label, completed, batches, count, activeBatch, percent } = pullReviewActivity(
    review,
    reviewers,
  )
  return (
    <div
      role="status"
      aria-live="polite"
      className="pr-review-motion min-w-0 rounded-xl border bg-muted/20 p-4"
      data-review-phase={phase}
      data-reduced-motion={preferences.motion === 'reduce'}
    >
      <style>{motion}</style>
      <svg
        viewBox="0 0 360 102"
        aria-hidden="true"
        className="mx-auto h-24 w-full max-w-md text-emerald-500"
      >
        {Array.from({ length: count }, (_, index) => {
          const y = 51 + (index - (count - 1) / 2) * 24
          return (
            <g key={index}>
              <path
                d={`M53 ${y} C100 ${y} 100 51 149 51`}
                fill="none"
                stroke="currentColor"
                opacity=".18"
              />
              <path
                className="pr-flow"
                style={{ animationDelay: `${index * -0.6}s` }}
                d={`M53 ${y} C100 ${y} 100 51 149 51`}
                fill="none"
                stroke="currentColor"
              />
              <rect
                x="24"
                y={y - 10}
                width="29"
                height="20"
                rx="4"
                fill="currentColor"
                fillOpacity=".06"
                stroke="currentColor"
                opacity=".65"
              />
              <path d={`M31 ${y - 3}h13 M31 ${y + 3}h8`} stroke="currentColor" opacity=".6" />
            </g>
          )
        })}
        <circle
          cx="174"
          cy="51"
          r="25"
          fill="currentColor"
          fillOpacity=".04"
          stroke="currentColor"
          strokeOpacity=".5"
        />
        <path
          d="M163 44h21 M163 51h16 M163 58h21"
          stroke="currentColor"
          strokeOpacity=".35"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          className="pr-scan"
          d="M158 51h32"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path d="M199 51h83" stroke="currentColor" strokeOpacity=".18" />
        <path className="pr-flow" d="M199 51h83" stroke="currentColor" />
        <rect
          x="282"
          y="28"
          width="40"
          height="46"
          rx="6"
          fill="currentColor"
          fillOpacity=".04"
          stroke="currentColor"
          strokeOpacity=".5"
        />
        <path
          d="m292 43 4 4 8-9 M292 56h20 M292 63h14"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{uiText(label)}</span>
        {!!batches && phase !== 'combining' && (
          <span className="text-muted-foreground">
            {uiText('Batch {value0} of {value1}', {
              value0: activeBatch,
              value1: batches,
            })}
          </span>
        )}
      </div>
      <div
        className="mt-3 h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={uiText('Review progress')}
        aria-valuemin={0}
        aria-valuemax={batches || undefined}
        aria-valuenow={batches ? completed : undefined}
      >
        <div
          className="h-full rounded-full bg-emerald-500/60 transition-all duration-500 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
