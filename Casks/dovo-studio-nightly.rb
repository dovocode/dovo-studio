cask "dovo-studio-nightly" do
  version "0.0.7-nightly.87"
  sha256 "3fffc7efe2a74a06165863485056d7b43354c2ead54a0d1b814f8fc41a2706da"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.87/Dovo-Studio-Nightly-0.0.7-nightly.87-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
