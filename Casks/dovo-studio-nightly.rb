cask "dovo-studio-nightly" do
  version "0.0.9-nightly.978"
  sha256 "77aec15991095def0cec3acb05e4bd10792cf641865264024e38a68b8ed361af"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.978/Dovo-Studio-Nightly-0.0.9-nightly.978-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
