cask "dovo-studio-nightly" do
  version "0.0.7-nightly.60"
  sha256 "e7268ca9269436d3c726546a0f2846457de58a13393559d5ebcdd8b02d16f381"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.60/Dovo-Studio-Nightly-0.0.7-nightly.60-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
