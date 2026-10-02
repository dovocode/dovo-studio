cask "dovo-studio-nightly" do
  version "0.0.7-nightly.143"
  sha256 "12ce452067c7d2c15dffa656bd586c19ea0dc6c8c64ac00bc2fba0404cd520e5"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.143/Dovo-Studio-Nightly-0.0.7-nightly.143-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
