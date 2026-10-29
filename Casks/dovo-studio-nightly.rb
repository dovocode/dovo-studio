cask "dovo-studio-nightly" do
  version "0.0.9-nightly.584"
  sha256 "77066b32ce30e953af7e9e7d4a094217233f18a17d5b8bb00f197cae45207619"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.584/Dovo-Studio-Nightly-0.0.9-nightly.584-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
