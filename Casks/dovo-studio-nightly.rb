cask "dovo-studio-nightly" do
  version "0.0.9-nightly.623"
  sha256 "15508c6550368809bddb2a57b975a89999db530afc2c9dffad57c6227069318f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.623/Dovo-Studio-Nightly-0.0.9-nightly.623-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
