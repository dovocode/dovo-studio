cask "dovo-studio-nightly" do
  version "0.0.7-nightly.179"
  sha256 "36650bb2c6527d084d49378a32c2542cd1afe3b9691c31d8a7fcfb302e8c5d2e"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.179/Dovo-Studio-Nightly-0.0.7-nightly.179-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
