import ExpoModulesCore

struct GalleryImageRecord: Record {
  @Field var id: String = ""
  @Field var name: String = ""
  @Field var uri: String? = nil
  @Field var error: String? = nil
}
public class DovoImageGalleryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DovoImageGallery")
    View(DovoImageGalleryExpoView.self) {
      Events("onClose", "onSelect", "onEdit", "onRetry")
      Prop("images") { (view: DovoImageGalleryExpoView, images: [GalleryImageRecord]) in
        view.gallery.setImages(images.map { GalleryImage(id: $0.id, name: $0.name, uri: $0.uri, error: $0.error) })
      }
      Prop("selectedID") { (view: DovoImageGalleryExpoView, id: String) in view.gallery.select(id) }
      Prop("editable") { (view: DovoImageGalleryExpoView, enabled: Bool) in view.gallery.editable = enabled }
      Prop("labels") { (view: DovoImageGalleryExpoView, labels: [String: String]) in view.gallery.labels = labels }
    }
  }
}
class DovoImageGalleryExpoView: ExpoView {
  let gallery = ImageGalleryView()
  let onClose = EventDispatcher()
  let onSelect = EventDispatcher()
  let onEdit = EventDispatcher()
  let onRetry = EventDispatcher()
  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addSubview(gallery)
    gallery.onClose = { [weak self] in self?.onClose([:]) }
    gallery.onSelect = { [weak self] id in self?.onSelect(["id": id]) }
    gallery.onEdit = { [weak self] id in self?.onEdit(["id": id]) }
    gallery.onRetry = { [weak self] id in self?.onRetry(["id": id]) }
  }
  override func layoutSubviews() { super.layoutSubviews(); gallery.frame = bounds }
}
