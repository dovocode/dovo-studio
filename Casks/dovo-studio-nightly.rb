cask "dovo-studio-nightly" do
  version "0.0.7-nightly.28"
  sha256 "0a249ee30af00fcc60f3503821fc3c3d3f4dbc37c09037f7c2e769afa6d06205"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.28/Dovo-Studio-Nightly-0.0.7-nightly.28-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
