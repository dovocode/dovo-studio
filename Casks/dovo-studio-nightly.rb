cask "dovo-studio-nightly" do
  version "0.0.7-nightly.80"
  sha256 "e32f9cd93323f0a471d69a345d6f65e36bae56b0b9a55d81c68ef15a844b10c8"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.80/Dovo-Studio-Nightly-0.0.7-nightly.80-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
