cask "dovo-studio-nightly" do
  version "0.0.9-nightly.946"
  sha256 "e9f963d8052d2277801d813ab71d7620c302c61bdcfb82808250680a7661cf16"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.946/Dovo-Studio-Nightly-0.0.9-nightly.946-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
