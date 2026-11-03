cask "dovo-studio-nightly" do
  version "0.0.9-nightly.676"
  sha256 "d9ef158b525f067c58c9cc1a0225ed0775644ac04eecf5d4c8ce8b682f3f6911"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.676/Dovo-Studio-Nightly-0.0.9-nightly.676-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
