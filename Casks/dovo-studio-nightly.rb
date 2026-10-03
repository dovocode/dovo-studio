cask "dovo-studio-nightly" do
  version "0.0.7-nightly.191"
  sha256 "92f370972864f490cc4df76188cb748bde638e912812c5a772709f9a492426cf"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.191/Dovo-Studio-Nightly-0.0.7-nightly.191-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
