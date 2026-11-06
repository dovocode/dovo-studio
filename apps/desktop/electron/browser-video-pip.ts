/** Runs in the website's main frame after the host checks automatic-PiP permission. */
export async function enterAutomaticVideoPip(url: string) {
  if (location.href !== url || !document.hidden || !document.pictureInPictureEnabled) return false
  if (document.pictureInPictureElement) return true
  const videos = [...document.querySelectorAll('video')]
    .filter((video) => {
      const bounds = video.getBoundingClientRect()
      return (
        !video.paused &&
        !video.ended &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0 &&
        !video.disablePictureInPicture &&
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.bottom > 0 &&
        bounds.right > 0 &&
        bounds.top < innerHeight &&
        bounds.left < innerWidth &&
        getComputedStyle(video).visibility === 'visible' &&
        getComputedStyle(video).opacity !== '0'
      )
    })
    .sort((a, b) => {
      const area = (video: HTMLVideoElement) => {
        const rect = video.getBoundingClientRect()
        return (
          (Math.min(innerWidth, rect.right) - Math.max(0, rect.left)) *
          (Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top))
        )
      }
      return area(b) - area(a)
    })
  const video = videos[0]
  if (!video) return false
  await video.requestPictureInPicture()
  return true
}

/** Runs in each website frame before page scripts. Keep this function self-contained. */
export function installVideoPipTracking(
  report: (active: boolean) => void,
  returnToTab: () => void,
) {
  const add = document.addEventListener.bind(document)
  const apply = Reflect.apply
  const exits = new WeakSet<HTMLVideoElement>()
  const nativeExit = Document.prototype.exitPictureInPicture
  const nativeEnter = HTMLVideoElement.prototype.requestPictureInPicture
  if (!nativeExit || !nativeEnter) return
  // API exits and replacement videos also leave PiP with playback continuing. They must
  // not be mistaken for Chromium's native "Back to tab" control.
  Document.prototype.exitPictureInPicture = function () {
    const video = this.pictureInPictureElement
    if (video instanceof HTMLVideoElement) exits.add(video)
    return apply(nativeExit, this, []).finally(() => {
      if (video instanceof HTMLVideoElement) exits.delete(video)
    })
  }
  HTMLVideoElement.prototype.requestPictureInPicture = function () {
    const previous = this.ownerDocument.pictureInPictureElement
    if (previous instanceof HTMLVideoElement && previous !== this) exits.add(previous)
    return apply(nativeEnter, this, []).finally(() => {
      if (previous instanceof HTMLVideoElement) exits.delete(previous)
    })
  }
  add(
    'enterpictureinpicture',
    (event: Event) => {
      if (event.isTrusted) report(true)
    },
    true,
  )
  add(
    'leavepictureinpicture',
    (event: Event) => {
      if (!event.isTrusted || !(event.target instanceof HTMLVideoElement)) return
      const video = event.target
      report(false)
      // Chromium delivers the close event before applying X's pause. Let that native
      // transition settle before checking playback. API exits/replacements are captured
      // now because their promises can resolve before this task runs.
      const suppressed = exits.has(video)
      if (suppressed || video.srcObject) return
      setTimeout(() => {
        if (document.hidden && !document.pictureInPictureElement && !video.paused && !video.ended)
          returnToTab()
      }, 100)
    },
    true,
  )
}
