cask "dovo-studio-nightly" do
  version "0.0.9-nightly.701"
  sha256 "08236b99a427864e35666554b192096fa41b82f94b1fb99146f56c50d2dc6096"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.701/Dovo-Studio-Nightly-0.0.9-nightly.701-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
