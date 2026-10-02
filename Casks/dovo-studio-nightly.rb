cask "dovo-studio-nightly" do
  version "0.0.7-nightly.141"
  sha256 "1ab01b7e0d5a7679094b685e5ab1afaa5508c74175a7f940f7f320ad7ba6cb65"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.141/Dovo-Studio-Nightly-0.0.7-nightly.141-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
