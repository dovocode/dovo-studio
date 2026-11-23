import { createContext, useContext, useId, useRef, useState, type ReactNode } from 'react'
import { createComponentImplementation } from '@a2ui/react'
import { a2uiApis, a2uiDateTimeType } from '@dovo/protocol/a2ui'
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BellOff,
  Calendar,
  CalendarDays,
  Camera,
  Check,
  CircleAlert,
  CircleHelp,
  CircleUser,
  Download,
  Eye,
  EyeOff,
  FastForward,
  Folder,
  Heart,
  HeartOff,
  House,
  Image,
  Info,
  Lock,
  LockOpen,
  Mail,
  MapPin,
  Menu,
  MoreHorizontal,
  MoreVertical,
  Paperclip,
  Pause,
  Pencil,
  Phone,
  Play,
  Plus,
  Printer,
  RefreshCw,
  Rewind,
  Search,
  Send,
  Settings,
  Share2,
  ShoppingCart,
  SkipBack,
  SkipForward,
  Square,
  Star,
  StarHalf,
  StarOff,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
  Wallet,
  X,
} from 'lucide-react'
import { disabledContext } from './workbench'

export const modalTriggerContext = createContext<(() => void) | undefined>(undefined)

const icons = {
  accountCircle: CircleUser,
  add: Plus,
  arrowBack: ArrowLeft,
  arrowForward: ArrowRight,
  attachFile: Paperclip,
  calendarToday: Calendar,
  call: Phone,
  camera: Camera,
  check: Check,
  close: X,
  delete: Trash2,
  download: Download,
  edit: Pencil,
  event: CalendarDays,
  error: CircleAlert,
  fastForward: FastForward,
  favorite: Heart,
  favoriteOff: HeartOff,
  folder: Folder,
  help: CircleHelp,
  home: House,
  info: Info,
  locationOn: MapPin,
  lock: Lock,
  lockOpen: LockOpen,
  mail: Mail,
  menu: Menu,
  moreVert: MoreVertical,
  moreHoriz: MoreHorizontal,
  notificationsOff: BellOff,
  notifications: Bell,
  pause: Pause,
  payment: Wallet,
  person: User,
  phone: Phone,
  photo: Image,
  play: Play,
  print: Printer,
  refresh: RefreshCw,
  rewind: Rewind,
  search: Search,
  send: Send,
  settings: Settings,
  share: Share2,
  shoppingCart: ShoppingCart,
  skipNext: SkipForward,
  skipPrevious: SkipBack,
  star: Star,
  starHalf: StarHalf,
  starOff: StarOff,
  stop: Square,
  upload: Upload,
  visibility: Eye,
  visibilityOff: EyeOff,
  volumeDown: Volume1,
  volumeMute: Volume,
  volumeOff: VolumeX,
  volumeUp: Volume2,
  warning: TriangleAlert,
}

function Media({
  kind,
  url,
  posterUrl,
  description,
  children,
}: {
  kind: 'image' | 'video' | 'audio'
  url: string
  posterUrl?: string
  description?: string
  children: (onError: () => void) => ReactNode
}) {
  const [load, setLoad] = useState(false)
  const [failed, setFailed] = useState(false)
  const origins = [
    ...new Set(
      [url, posterUrl].flatMap((source) => {
        if (!source || !/^https?:/i.test(source)) return []
        return [new URL(source).host]
      }),
    ),
  ]
  if (failed) {
    return (
      <div className="media-placeholder">
        <span role="status">Could not load {description || kind}.</span>
        <button type="button" className="secondary" onClick={() => setFailed(false)}>
          Retry {description || kind}
        </button>
      </div>
    )
  }
  if (origins.length && !load) {
    return (
      <div className="media-placeholder">
        <button type="button" className="secondary" onClick={() => setLoad(true)}>
          Load {description || kind}
        </button>
        <span className="caption">{origins.join(', ')}</span>
      </div>
    )
  }
  return children(() => setFailed(true))
}

export const basicComponents = [
  createComponentImplementation(a2uiApis.Image, ({ props }) => (
    <Media key={props.url} kind="image" url={props.url} description={props.description}>
      {(onError) => (
        <img
          className="a2ui-image"
          data-variant={props.variant ?? 'mediumFeature'}
          style={{ objectFit: props.fit === 'scaleDown' ? 'scale-down' : props.fit }}
          src={props.url}
          alt={props.description ?? ''}
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={onError}
        />
      )}
    </Media>
  )),
  createComponentImplementation(a2uiApis.Icon, ({ props }) => {
    const Glyph = icons[props.name]
    return <Glyph className="a2ui-icon" size={20} aria-hidden="true" />
  }),
  createComponentImplementation(a2uiApis.Video, ({ props }) => (
    <Media key={JSON.stringify([props.url, props.posterUrl])} kind="video" {...props}>
      {(onError) => (
        <video
          className="a2ui-video"
          src={props.url}
          poster={props.posterUrl}
          aria-label={props.description || 'Video'}
          controls
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          onError={onError}
        />
      )}
    </Media>
  )),
  createComponentImplementation(a2uiApis.AudioPlayer, ({ props }) => (
    <Media key={props.url} kind="audio" {...props}>
      {(onError) => (
        <div className="field">
          {props.description && <span>{props.description}</span>}
          <audio
            className="a2ui-audio"
            src={props.url}
            aria-label={props.description || 'Audio'}
            controls
            preload="metadata"
            crossOrigin="anonymous"
            onError={onError}
          />
        </div>
      )}
    </Media>
  )),
  createComponentImplementation(a2uiApis.Modal, ({ props, buildChild }) => {
    const dialog = useRef<HTMLDialogElement>(null)
    const trigger = useRef<HTMLDivElement>(null)
    const titleId = useId()
    return (
      <>
        <div ref={trigger}>
          <modalTriggerContext.Provider value={() => dialog.current?.showModal()}>
            {buildChild(props.trigger)}
          </modalTriggerContext.Provider>
        </div>
        <dialog
          className="a2ui-modal"
          ref={dialog}
          aria-labelledby={props.title ? titleId : undefined}
          aria-label={props.title ? undefined : 'Details'}
          onClose={() => trigger.current?.querySelector('button')?.focus()}
        >
          <div className="modal-header">
            {props.title && <h2 id={titleId}>{props.title}</h2>}
            <button type="button" className="secondary" onClick={() => dialog.current?.close()}>
              Close
            </button>
          </div>
          {buildChild(props.content)}
        </dialog>
      </>
    )
  }),
  createComponentImplementation(a2uiApis.Slider, ({ props }) => {
    const disabled = useContext(disabledContext)
    const min = props.min ?? 0
    return (
      <label className="field">
        <span>
          {props.label ?? 'Value'} <span className="caption">{props.value}</span>
        </span>
        <input
          type="range"
          min={min}
          max={props.max}
          step={props.steps === undefined ? 'any' : (props.max - min) / props.steps}
          value={props.value ?? min}
          disabled={disabled}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber
            if (props.steps === undefined) {
              props.setValue(value)
              return
            }
            const range = props.max - min
            const index = Math.round(((value - min) / range) * props.steps)
            props.setValue(index === props.steps ? props.max : min + range * (index / props.steps))
          }}
        />
      </label>
    )
  }),
  createComponentImplementation(a2uiApis.DateTimeInput, ({ props }) => {
    const disabled = useContext(disabledContext)
    const type = a2uiDateTimeType(props)
    return (
      <label className="field">
        <span>
          {props.label ?? (type === 'time' ? 'Time' : type === 'date' ? 'Date' : 'Date and time')}
        </span>
        <input
          type={type}
          value={props.value ?? ''}
          min={props.min}
          max={props.max}
          step={type === 'date' ? undefined : 'any'}
          required={props.required}
          disabled={disabled}
          onChange={(event) => props.setValue(event.currentTarget.value)}
        />
      </label>
    )
  }),
]
