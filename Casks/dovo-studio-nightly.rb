cask "dovo-studio-nightly" do
  version "0.0.9-nightly.793"
  sha256 "b32268507cdcae56ca3df6e2fef850b4f9b77659be4d0e35ca19dc1d3c24c99f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.793/Dovo-Studio-Nightly-0.0.9-nightly.793-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
