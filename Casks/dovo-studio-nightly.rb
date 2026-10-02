cask "dovo-studio-nightly" do
  version "0.0.7-nightly.156"
  sha256 "39af1a0820e92eb2accdb32ed06460537315f79b202d9276bfa1260a7147130b"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.156/Dovo-Studio-Nightly-0.0.7-nightly.156-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
