cask "dovo-studio-nightly" do
  version "0.0.9-nightly.554"
  sha256 "cbd696ef5ce2aead4849011f33d27d2a10c29e21b3fdce5992dba90ec03d11c0"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.554/Dovo-Studio-Nightly-0.0.9-nightly.554-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
