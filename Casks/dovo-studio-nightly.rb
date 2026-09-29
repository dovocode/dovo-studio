cask "dovo-studio-nightly" do
  version "0.0.7-nightly.33"
  sha256 "05ae03c448b5e0eeccc37266212738584b5cc52a6477be305554065fdb62bfd6"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.33/Dovo-Studio-Nightly-0.0.7-nightly.33-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
