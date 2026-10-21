cask "dovo-studio-nightly" do
  version "0.0.9-nightly.440"
  sha256 "9f25d4b4c7eba39be2f270cca74d9c828ca46b5bbb3b48ebbe1f1f20311096c2"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.440/Dovo-Studio-Nightly-0.0.9-nightly.440-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
