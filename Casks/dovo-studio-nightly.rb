cask "dovo-studio-nightly" do
  version "0.0.7-nightly.118"
  sha256 "b72da2cec0b7072910d0d1f1d9bcb3399b88208d68ea9eaeebaa239d921e4f46"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.118/Dovo-Studio-Nightly-0.0.7-nightly.118-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
