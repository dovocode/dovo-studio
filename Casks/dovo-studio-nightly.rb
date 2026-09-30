cask "dovo-studio-nightly" do
  version "0.0.7-nightly.94"
  sha256 "24380e92cf795980688d7274b7adb8759bc63e79d02c26cfb312be9a49ebfc88"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.94/Dovo-Studio-Nightly-0.0.7-nightly.94-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
