import UIKit

@main class Harness: UIResponder, UIApplicationDelegate {}
@objc(GalleryHarnessScene) class GalleryHarnessScene: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: scene)
    let controller = UIViewController()
    window.rootViewController = controller
    window.makeKeyAndVisible()
    self.window = window
    let gallery = ImageGalleryView(frame: window.bounds)
    gallery.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    controller.view.addSubview(gallery)
    let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("image-gallery/harness")
    try! FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let colors: [UIColor] = [.systemBlue, .systemGreen, .systemOrange, .systemPink, .systemPurple]
    let items = colors.enumerated().map { index, color -> GalleryImage in
      let image = UIGraphicsImageRenderer(size: CGSize(width: 600, height: 800)).image { context in
        color.setFill(); context.fill(CGRect(x: 0, y: 0, width: 600, height: 800))
        "Image \(index + 1)".draw(at: CGPoint(x: 140, y: 360), withAttributes: [.font: UIFont.systemFont(ofSize: 48), .foregroundColor: UIColor.white])
      }
      let url = root.appendingPathComponent("image-\(index + 1).png")
      try! image.pngData()!.write(to: url)
      return GalleryImage(id: "image-\(index + 1)", name: "Image \(index + 1).png", uri: url.absoluteString, error: nil)
    }
    gallery.setImages(items)
    gallery.select("image-3")
    gallery.onClose = { print("GALLERY-CLOSE"); fflush(stdout) }
    gallery.onSelect = { print("GALLERY-SELECT \($0)"); fflush(stdout) }
    gallery.layoutIfNeeded()
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
      var checks = 0
      func check(_ condition: Bool, _ message: String) {
        checks += 1
        if !condition { print("GALLERY-FAIL \(message)"); fflush(stdout); exit(1) }
      }
      check(gallery.selectedID == "image-3", "initial stable selection")
      check(gallery.pages.count == 3, "only adjacent pages decoded")
      check(gallery.pages[2]?.imageView.image != nil, "image decoded")
      gallery.pages[2]?.setZoomScale(3, animated: false)
      check(gallery.pages[2]?.zoomScale == 3, "pinch zoom range")
      gallery.select("image-5")
      gallery.layoutIfNeeded()
      check(gallery.pages.count == 2 && gallery.pages[2] == nil, "far images released")
      gallery.setImages(items.reversed())
      gallery.layoutIfNeeded()
      check(gallery.selectedID == "image-5", "selection survives reordered identities")
      gallery.select("image-1")
      gallery.layoutIfNeeded()
      gallery.pager.contentOffset = CGPoint(x: gallery.pager.bounds.width * 2, y: 0)
      gallery.scrollViewDidEndDecelerating(gallery.pager)
      check(gallery.selectedID == "image-3", "paging selects correct identity")
      gallery.setImages([])
      gallery.layoutIfNeeded()
      check(gallery.pages.isEmpty, "empty gallery releases decoded pages")
      gallery.setImages(items)
      gallery.select("image-1")
      gallery.layoutIfNeeded()
      let brokenURL = root.appendingPathComponent("broken.png")
      try! Data("invalid image".utf8).write(to: brokenURL)
      let broken = GalleryImage(id: "broken", name: "Broken image", uri: brokenURL.absoluteString, error: nil)
      let page = GalleryZoomPage(frame: gallery.pager.bounds)
      controller.view.addSubview(page)
      var retried = false
      page.display(broken, retry: "Retry") { retried = true }
      let deadline = Date().addingTimeInterval(5)
      func awaitDecodeFailure() {
        guard let retry = page.subviews.compactMap({ $0 as? UIButton }).first, !retry.isHidden else {
          if Date() > deadline { check(false, "decode failure offers retry"); return }
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.02, execute: awaitDecodeFailure)
          return
        }
        // Layout repeatedly resupplies the same image. It must keep the decode failure visible.
        page.display(broken, retry: "Retry") { retried = true }
        page.layoutIfNeeded()
        check(!retry.isHidden, "decode retry survives layout")
        retry.sendActions(for: .touchUpInside)
        check(retried, "decode retry dispatches its event")
        page.display(items[0], retry: "Retry") {}
        check(retry.isHidden, "new file clears decode failure")
        func awaitRecoveredImage() {
          guard page.imageView.image != nil else {
            if Date() > deadline { check(false, "new image decodes after failure"); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.02, execute: awaitRecoveredImage)
            return
          }
          check(page.imageView.image != nil, "new image decodes after failure")
          page.removeFromSuperview()
          try! "GALLERY-PASS \(checks)".write(to: root.appendingPathComponent("report.txt"), atomically: true, encoding: .utf8)
          print("GALLERY-PASS \(checks)")
          fflush(stdout)
        }
        awaitRecoveredImage()
      }
      awaitDecodeFailure()
    }
  }
}
