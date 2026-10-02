cask "dovo-studio-nightly" do
  version "0.0.7-nightly.145"
  sha256 "44b9782a2d44ab95190007ef16719e9c2473cbc8ba9f5bc3f1050525e858dae0"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.145/Dovo-Studio-Nightly-0.0.7-nightly.145-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
