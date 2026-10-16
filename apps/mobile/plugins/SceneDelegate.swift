internal import Expo

class SceneDelegate: ExpoAppSceneDelegate {
  override func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    // Quick Actions emits its cold-start event before JS subscribes. Seed Expo Linking's
    // synchronous initial URL before Expo starts React Native so Router opens the task form.
    if options.urlContexts.isEmpty,
      options.userActivities.isEmpty,
      options.shortcutItem?.type == "dovo.launch",
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let url = URL(string: "dovo://launch") {
      _ = appDelegate.application(UIApplication.shared, open: url, options: [:])
    }
    super.scene(scene, willConnectTo: session, options: options)
  }
}
