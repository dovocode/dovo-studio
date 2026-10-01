cask "dovo-studio-nightly" do
  version "0.0.7-nightly.112"
  sha256 "66c5b60de347cfa98c1491fa14cbb015dbc59956e119e04699e3390bf3b7c4cf"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.112/Dovo-Studio-Nightly-0.0.7-nightly.112-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
