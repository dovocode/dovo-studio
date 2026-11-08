cask "dovo-studio-nightly" do
  version "0.0.9-nightly.737"
  sha256 "c48737d34e2f5dc317d95f805e645b9bb06f91feb72220588a461104d93c12ed"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.737/Dovo-Studio-Nightly-0.0.9-nightly.737-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
