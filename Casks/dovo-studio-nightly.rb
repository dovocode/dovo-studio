cask "dovo-studio-nightly" do
  version "0.0.7-nightly.104"
  sha256 "87e0ffcb9bdc19701c3cb5d1e24a53c4adcb500314ba95857e6fa993ecff1dbb"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.104/Dovo-Studio-Nightly-0.0.7-nightly.104-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
