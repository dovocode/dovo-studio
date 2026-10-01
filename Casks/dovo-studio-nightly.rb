cask "dovo-studio-nightly" do
  version "0.0.7-nightly.115"
  sha256 "8f41f2c7845e903f0f8f474ba7e906b89a051c629b6510dffe9c90e3ffafc835"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.115/Dovo-Studio-Nightly-0.0.7-nightly.115-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
