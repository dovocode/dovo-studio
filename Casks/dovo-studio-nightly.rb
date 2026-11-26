cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1109"
  sha256 "16612708a74b4d28a362c7841ad62563644cc609598953ae42c4d4923e6be3a8"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1109/Dovo-Studio-Nightly-0.0.9-nightly.1109-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
