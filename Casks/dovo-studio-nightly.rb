cask "dovo-studio-nightly" do
  version "0.0.7-nightly.127"
  sha256 "d2bce730d9c613853ee7f7359cc90d3bf69d059cd7dcd3c30d8845e53c0774ab"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.127/Dovo-Studio-Nightly-0.0.7-nightly.127-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
