cask "dovo-studio-nightly" do
  version "0.0.9-nightly.269"
  sha256 "89f2439fffd22fbe07844267bad2e29ce1ea0a5796c12c06d3ec15cd69273b76"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.269/Dovo-Studio-Nightly-0.0.9-nightly.269-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
