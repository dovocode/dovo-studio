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
