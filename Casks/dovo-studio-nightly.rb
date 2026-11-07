cask "dovo-studio-nightly" do
  version "0.0.9-nightly.730"
  sha256 "7ea56106e670fb04a772a7f21cace05b2a09d35961decfdffdf07d20bc1ee2ee"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.730/Dovo-Studio-Nightly-0.0.9-nightly.730-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
