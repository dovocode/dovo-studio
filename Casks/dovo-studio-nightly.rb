cask "dovo-studio-nightly" do
  version "0.0.9-nightly.337"
  sha256 "f12312ca3b29e1a47724983eef2539d7525e336c0571bea9d887da273bc03773"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.337/Dovo-Studio-Nightly-0.0.9-nightly.337-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
