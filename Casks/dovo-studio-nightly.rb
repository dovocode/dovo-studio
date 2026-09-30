cask "dovo-studio-nightly" do
  version "0.0.7-nightly.78"
  sha256 "dd40e18e7ae40b9b3b14290ae5cd37a5ef3caed81f3e2aa82b2b6b0171651e10"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.78/Dovo-Studio-Nightly-0.0.7-nightly.78-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
