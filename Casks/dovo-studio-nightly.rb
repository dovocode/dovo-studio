cask "dovo-studio-nightly" do
  version "0.0.9-nightly.360"
  sha256 "6b009b22c5283f4e04efd0a6fa9517aff0dffb9967bd3dce368913c59b8b31e1"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.360/Dovo-Studio-Nightly-0.0.9-nightly.360-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
