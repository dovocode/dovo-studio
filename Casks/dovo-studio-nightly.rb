cask "dovo-studio-nightly" do
  version "0.0.9-nightly.684"
  sha256 "3aa1a5c5afddd1163cfe3b62389b8b54a9a22e496d67c3ad270fd43424a6e25f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.684/Dovo-Studio-Nightly-0.0.9-nightly.684-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
