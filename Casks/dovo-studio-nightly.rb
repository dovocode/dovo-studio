cask "dovo-studio-nightly" do
  version "0.0.9-nightly.575"
  sha256 "a9b2e5ad2c8deb81804becf19bd24f113573780bd75abe34b9c5ccad619a60fc"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.575/Dovo-Studio-Nightly-0.0.9-nightly.575-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
