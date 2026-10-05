cask "dovo-studio-nightly" do
  version "0.0.7-nightly.224"
  sha256 "dada09b452f0cb754e85cda5ff3255ac8c4a67031b64a268d7217e9a7ac618fd"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.224/Dovo-Studio-Nightly-0.0.7-nightly.224-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
