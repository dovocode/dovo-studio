import UIKit
import ImageIO
import UniformTypeIdentifiers

struct GalleryImage {
  let id: String
  let name: String
  let uri: String?
  let error: String?
}

// No network access. JS supplies files in this app's private preview cache.
final class ImageGalleryView: UIView, UIScrollViewDelegate, UIGestureRecognizerDelegate {
  var onClose: (() -> Void)?
  var onSelect: ((String) -> Void)?
  var onEdit: ((String) -> Void)?
  var onRetry: ((String) -> Void)?
  var editable = false { didSet { updateControls() } }
  var labels: [String: String] = [:] { didSet { updateControls() } }
  private(set) var images: [GalleryImage] = []
  private(set) var selectedID = ""
  private(set) var pages: [Int: GalleryZoomPage] = [:]
  let pager = UIScrollView()
  private let toolbar = UIStackView()
  private let title = UILabel()
  private let close = UIButton(type: .system)
  private let share = UIButton(type: .system)
  private let save = UIButton(type: .system)
  private let edit = UIButton(type: .system)
  private var index: Int { images.firstIndex { $0.id == selectedID } ?? 0 }
  private var previousSize = CGSize.zero
  private var selected: GalleryImage? { images.indices.contains(index) ? images[index] : nil }

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .systemBackground
    pager.isPagingEnabled = true
    pager.showsHorizontalScrollIndicator = false
    pager.delegate = self
    addSubview(pager)
    toolbar.axis = .horizontal
    toolbar.alignment = .center
    toolbar.spacing = 4
    title.font = .preferredFont(forTextStyle: .subheadline)
    title.adjustsFontForContentSizeCategory = true
    title.lineBreakMode = .byTruncatingMiddle
    title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    for (button, symbol, action) in [
      (close, "xmark", #selector(dismiss)), (share, "square.and.arrow.up", #selector(shareImage)),
      (save, "square.and.arrow.down", #selector(saveImage)), (edit, "pencil", #selector(editImage))
    ] {
      button.setImage(UIImage(systemName: symbol), for: .normal)
      button.addTarget(self, action: action, for: .touchUpInside)
      button.widthAnchor.constraint(equalToConstant: 44).isActive = true
      button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    }
    [title, edit, share, save, close].forEach { toolbar.addArrangedSubview($0) }
    addSubview(toolbar)
    let pan = UIPanGestureRecognizer(target: self, action: #selector(dragToClose(_:)))
    pan.delegate = self
    pager.addGestureRecognizer(pan)
    updateControls()
  }
  @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

  func setImages(_ value: [GalleryImage]) {
    images = value
    if !images.contains(where: { $0.id == selectedID }) { selectedID = images.first?.id ?? "" }
    updatePages()
    setNeedsLayout()
  }
  func select(_ id: String) {
    guard selectedID != id else { return }
    selectedID = id
    setNeedsLayout()
    updatePages()
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    let top = safeAreaInsets.top
    let height = max(44, title.intrinsicContentSize.height + 16)
    toolbar.frame = CGRect(x: 12, y: top, width: max(0, bounds.width - 24), height: height)
    pager.frame = CGRect(x: 0, y: toolbar.frame.maxY, width: bounds.width, height: max(0, bounds.height - toolbar.frame.maxY - safeAreaInsets.bottom))
    pager.contentSize = CGSize(width: pager.bounds.width * CGFloat(images.count), height: pager.bounds.height)
    if previousSize != pager.bounds.size { previousSize = pager.bounds.size; pages.values.forEach { $0.resetZoom() } }
    if !pager.isDragging && !pager.isDecelerating { pager.contentOffset = CGPoint(x: CGFloat(index) * pager.bounds.width, y: 0) }
    updatePages()
  }
  private func updatePages() {
    let nearby = Set(max(0, index - 1)...min(max(0, images.count - 1), index + 1))
    for key in Array(pages.keys) where !nearby.contains(key) { pages.removeValue(forKey: key)?.removeFromSuperview() }
    for position in nearby where images.indices.contains(position) {
      let page = pages[position] ?? GalleryZoomPage()
      if pages[position] == nil { pages[position] = page; pager.addSubview(page) }
      page.frame = CGRect(x: CGFloat(position) * pager.bounds.width, y: 0, width: pager.bounds.width, height: pager.bounds.height)
      let imageID = images[position].id
      page.display(images[position], retry: labels["retry"] ?? "Retry") { [weak self] in self?.onRetry?(imageID) }
    }
    updateControls()
  }
  private func updateControls() {
    title.text = selected.map { "\(index + 1) / \(images.count)  \($0.name)" }
    close.accessibilityLabel = labels["close"] ?? "Close preview"
    share.accessibilityLabel = labels["share"] ?? "Share file"
    save.accessibilityLabel = labels["save"] ?? "Save"
    edit.accessibilityLabel = labels["edit"] ?? "Edit"
    edit.isHidden = !editable
    share.isEnabled = localURL() != nil
    save.isEnabled = share.isEnabled
  }
  func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
    guard pager.bounds.width > 0, !images.isEmpty else { return }
    let position = min(images.count - 1, max(0, Int(round(pager.contentOffset.x / pager.bounds.width))))
    selectedID = images[position].id
    pages.values.forEach { $0.resetZoom() }
    updatePages()
    onSelect?(selectedID)
  }
  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    guard let pan = gestureRecognizer as? UIPanGestureRecognizer, (pages[index]?.zoomScale ?? 1) <= 1.01 else { return false }
    let velocity = pan.velocity(in: self)
    return abs(velocity.y) > abs(velocity.x) && velocity.y > 0
  }
  @objc private func dragToClose(_ pan: UIPanGestureRecognizer) {
    let distance = max(0, pan.translation(in: self).y)
    if pan.state == .changed { pager.transform = CGAffineTransform(translationX: 0, y: distance) }
    if pan.state == .ended || pan.state == .cancelled {
      if pan.state == .ended && (distance > 120 || pan.velocity(in: self).y > 900) { onClose?() }
      UIView.animate(withDuration: 0.2) { self.pager.transform = .identity }
    }
  }
  @objc private func dismiss() { onClose?() }
  @objc private func editImage() { if let selected { onEdit?(selected.id) } }
  private func localURL() -> URL? {
    guard let uri = selected?.uri, let url = URL(string: uri), url.isFileURL,
      let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
      url.resolvingSymlinksInPath().path.hasPrefix(cache.appendingPathComponent("image-gallery").path + "/"),
      FileManager.default.fileExists(atPath: url.path) else { return nil }
    return url
  }
  private func presenter() -> UIViewController? {
    var candidate: UIResponder? = self
    while let current = candidate { if let controller = current as? UIViewController { return controller }; candidate = current.next }
    return nil
  }
  @objc private func shareImage() {
    guard let url = localURL(), let presenter = presenter(), presenter.presentedViewController == nil else { return }
    let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
    activity.popoverPresentationController?.sourceView = share
    activity.popoverPresentationController?.sourceRect = share.bounds
    presenter.present(activity, animated: true)
  }
  @objc private func saveImage() {
    guard let url = localURL(), let presenter = presenter(), presenter.presentedViewController == nil else { return }
    presenter.present(UIDocumentPickerViewController(forExporting: [url], asCopy: true), animated: true)
  }
}

final class GalleryZoomPage: UIScrollView, UIScrollViewDelegate {
  private static let decoder = DispatchQueue(label: "dovo.image-gallery.decode", qos: .userInitiated)
  private var decoding: DispatchWorkItem?
  let imageView = UIImageView()
  private let status = UIButton(type: .system)
  private let spinner = UIActivityIndicatorView(style: .large)
  private var identity = ""
  private var decodeFailed = false
  private var retry: (() -> Void)?
  override init(frame: CGRect) {
    super.init(frame: frame)
    delegate = self
    minimumZoomScale = 1
    maximumZoomScale = 4
    showsHorizontalScrollIndicator = false
    showsVerticalScrollIndicator = false
    imageView.contentMode = .scaleAspectFit
    addSubview(imageView)
    addSubview(status)
    addSubview(spinner)
    status.titleLabel?.numberOfLines = 0
    status.addTarget(self, action: #selector(retryImage), for: .touchUpInside)
    let doubleTap = UITapGestureRecognizer(target: self, action: #selector(toggleZoom(_:)))
    doubleTap.numberOfTapsRequired = 2
    addGestureRecognizer(doubleTap)
  }
  @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }
  func display(_ item: GalleryImage, retry label: String, onRetry: @escaping () -> Void) {
    retry = onRetry
    imageView.accessibilityLabel = item.name
    imageView.isAccessibilityElement = true
    let key = "\(item.id):\(item.uri ?? "")"
    if key != identity { decodeFailed = false }
    status.setTitle(item.error.map { "\($0)\n\(label)" } ?? (decodeFailed ? label : nil), for: .normal)
    status.isHidden = item.error == nil && !decodeFailed
    if item.uri == nil && item.error == nil { spinner.startAnimating() } else { spinner.stopAnimating() }
    guard key != identity else { return }
    decoding?.cancel()
    identity = key
    imageView.image = nil
    resetZoom()
    guard let uri = item.uri, let url = URL(string: uri), url.isFileURL else { return }
    let pixels = min(4096, max(1024, max(bounds.width, bounds.height) * UIScreen.main.scale * 2))
    let work = DispatchWorkItem { [weak self] in
      guard self != nil else { return }
      let source = CGImageSourceCreateWithURL(url as CFURL, nil)
      let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: pixels, kCGImageSourceCreateThumbnailWithTransform: true]
      let image = source.flatMap { CGImageSourceCreateThumbnailAtIndex($0, 0, options as CFDictionary) }.map { UIImage(cgImage: $0) }
      DispatchQueue.main.async {
        guard let self, self.identity == key else { return }
        self.imageView.image = image
        self.decodeFailed = image == nil
        if image == nil { self.status.setTitle(label, for: .normal); self.status.isHidden = false }
      }
    }
    decoding = work
    Self.decoder.async(execute: work)
  }
  deinit { decoding?.cancel() }
  override func layoutSubviews() {
    super.layoutSubviews()
    if zoomScale == 1 { imageView.frame = bounds; contentSize = bounds.size }
    spinner.center = CGPoint(x: bounds.midX, y: bounds.midY)
    status.frame = CGRect(x: bounds.minX + 24, y: bounds.midY - 60, width: max(0, bounds.width - 48), height: 120)
  }
  func resetZoom() { setZoomScale(1, animated: false); setNeedsLayout() }
  func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
  @objc private func retryImage() { retry?() }
  @objc private func toggleZoom(_ tap: UITapGestureRecognizer) {
    if zoomScale > 1 { setZoomScale(1, animated: true); return }
    let point = tap.location(in: imageView)
    let size = CGSize(width: bounds.width / 2.5, height: bounds.height / 2.5)
    zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
  }
}
