cask "dovo-studio-nightly" do
  version "0.0.9-nightly.454"
  sha256 "3d022f30d3a32e16cc7a101bfa14328fdc536bbe9daea5d039942eeb505cc0ff"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.454/Dovo-Studio-Nightly-0.0.9-nightly.454-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
