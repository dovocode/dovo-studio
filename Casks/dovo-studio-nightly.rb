cask "dovo-studio-nightly" do
  version "0.0.7-nightly.159"
  sha256 "a63fe5d2ed5c771f3ecb0741d5669e53807a1f1fbd3180a319dc68028ab19fb5"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.159/Dovo-Studio-Nightly-0.0.7-nightly.159-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
