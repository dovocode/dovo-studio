cask "dovo-studio-nightly" do
  version "0.0.9-nightly.687"
  sha256 "391ed12d7e81470dab64187b3954a01b3123d5ae070dce5ce9397fbfa9f3466e"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.687/Dovo-Studio-Nightly-0.0.9-nightly.687-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
