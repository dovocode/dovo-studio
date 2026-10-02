cask "dovo-studio-nightly" do
  version "0.0.7-nightly.165"
  sha256 "4c1f0f0a3b8f1d0c359ea64a825d49b97cfe10875117b29af6a064b8050ebcb1"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.165/Dovo-Studio-Nightly-0.0.7-nightly.165-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
