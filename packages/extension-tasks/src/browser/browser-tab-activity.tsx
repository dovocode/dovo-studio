import { Bot, Camera, Mic, ScreenShare, Volume2, VolumeX } from 'lucide-react'
import { cn, IconButton } from '@dovo/studio-ui'
import type { BrowserTabState } from '@dovo/protocol'

/** Shared media signals and fixed pinned slots in both browser and unified sidebars. */
export function BrowserTabActivity({
  state,
  title,
  pinned = false,
  onMute,
}: {
  state?: BrowserTabState
  title: string
  pinned?: boolean
  onMute?: () => void
}) {
  const agentBadge = state?.agent ? (
    <span
      role="img"
      data-browser-activity="agent"
      aria-label={`An agent is connected to ${title}`}
      title="An agent is connected to this tab"
      className="shrink-0"
    >
      <Bot className={pinned ? 'size-2.5' : 'size-3'} />
    </span>
  ) : null
  const activityShown = !!(
    state?.camera ||
    state?.microphone ||
    state?.screenSharing ||
    state?.audible ||
    state?.muted ||
    state?.agent
  )
  return (
    <>
      {' '}
      {(pinned || activityShown) && (
        <div
          aria-label={activityShown ? 'Tab activity' : undefined}
          aria-hidden={!activityShown || undefined}
          className={cn(
            'studio-browser-tab-activity relative flex min-w-0 shrink-0 flex-wrap items-center text-status-success',
            pinned ? 'max-w-full justify-center gap-0.5 px-0.5 pb-1.5' : 'gap-1',
          )}
        >
          {state && (
            <>
              {(state.audible || state.muted) &&
                (onMute ? (
                  <IconButton
                    type="button"
                    data-browser-activity="audio"
                    label={`${state.muted ? 'Unmute' : 'Mute'} tab ${title}`}
                    aria-pressed={state.muted}
                    className={cn('shrink-0', pinned ? 'size-4' : 'size-5')}
                    onClick={onMute}
                  >
                    {state.muted ? (
                      <VolumeX className={pinned ? 'size-2.5' : 'size-3'} />
                    ) : (
                      <Volume2 className={pinned ? 'size-2.5' : 'size-3'} />
                    )}
                  </IconButton>
                ) : (
                  <span
                    role="img"
                    data-browser-activity="audio"
                    aria-label={`${state.muted ? 'Audio muted' : 'Audio playing'} in ${title}`}
                  >
                    {state.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                  </span>
                ))}
              {state.microphone && (
                <span
                  data-browser-activity="microphone"
                  role="img"
                  aria-label={`Microphone on in ${title}`}
                  title="Microphone on"
                >
                  <Mic className={pinned ? 'size-2.5' : 'size-3'} />
                </span>
              )}
              {state.screenSharing && (
                <span
                  data-browser-activity="screen"
                  role="img"
                  aria-label={`Screen sharing in ${title}`}
                  title="Screen sharing"
                >
                  <ScreenShare className={pinned ? 'size-2.5' : 'size-3'} />
                </span>
              )}
              {state.camera && (
                <span
                  data-browser-activity="camera"
                  role="img"
                  aria-label={`Camera on in ${title}`}
                  title="Camera on"
                >
                  <Camera className={pinned ? 'size-2.5' : 'size-3'} />
                </span>
              )}
              {agentBadge}
            </>
          )}
        </div>
      )}
      {!activityShown && agentBadge}
    </>
  )
}
