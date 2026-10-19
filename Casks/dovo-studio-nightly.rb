cask "dovo-studio-nightly" do
  version "0.0.9-nightly.402"
  sha256 "4dadaefe38267fbc0ce6933383723548ec2ccc5839d348b872224adde7bfb489"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.402/Dovo-Studio-Nightly-0.0.9-nightly.402-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
