cask "dovo-studio-nightly" do
  version "0.0.7-nightly.111"
  sha256 "2ddf6c37449aeb81155032e19b9b0601003dcea5ae90d71842e440ad1a5f2660"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.111/Dovo-Studio-Nightly-0.0.7-nightly.111-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
