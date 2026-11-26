cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1113"
  sha256 "4914af39995a608fbc75e70090e3f7d2e39839244f47ae6357d7b3d9d77d70e1"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1113/Dovo-Studio-Nightly-0.0.9-nightly.1113-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
