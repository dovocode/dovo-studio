cask "dovo-studio-nightly" do
  version "0.0.7-nightly.176"
  sha256 "aaaaa65990efb4b609f74efe22013dcf7049c3388ff41db6c9ea5467645ffd15"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.176/Dovo-Studio-Nightly-0.0.7-nightly.176-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
