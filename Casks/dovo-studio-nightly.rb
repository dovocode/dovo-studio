cask "dovo-studio-nightly" do
  version "0.0.9-nightly.879"
  sha256 "0a613948aa297421dcae28ffdc96e6d8d79dc264a08f41f361debfb67df6b1d9"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.879/Dovo-Studio-Nightly-0.0.9-nightly.879-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
