cask "dovo-studio-nightly" do
  version "0.0.9-nightly.560"
  sha256 "06652738c1f65730791012570b21cb7aeaae7fc508a5b1d644944d463cfc9b39"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.560/Dovo-Studio-Nightly-0.0.9-nightly.560-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
