cask "dovo-studio-nightly" do
  version "0.0.7-nightly.84"
  sha256 "458e65103427a1f467231c3fe0dca524bf9cd173ae961b98ca7e7333149e8970"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.84/Dovo-Studio-Nightly-0.0.7-nightly.84-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
