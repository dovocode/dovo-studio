cask "dovo-studio-nightly" do
  version "0.0.7-nightly.31"
  sha256 "4e3b30db2030c4ec447c071836f55a43c2814b7011299b802b8165545534e5f6"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.31/Dovo-Studio-Nightly-0.0.7-nightly.31-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
