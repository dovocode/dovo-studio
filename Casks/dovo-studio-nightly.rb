cask "dovo-studio-nightly" do
  version "0.0.9-nightly.395"
  sha256 "020d85917857a2667597fbab0df4c97550af2f8f89dd7f2c0a6f5c7f4a90e161"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.395/Dovo-Studio-Nightly-0.0.9-nightly.395-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
