cask "dovo-studio-nightly" do
  version "0.0.9-nightly.380"
  sha256 "4c764da0011772659810b52ece8ac8c99e462c57f949be9a9cd2b6caf59534c4"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.380/Dovo-Studio-Nightly-0.0.9-nightly.380-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
