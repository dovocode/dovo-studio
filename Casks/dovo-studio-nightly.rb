cask "dovo-studio-nightly" do
  version "0.0.9-nightly.392"
  sha256 "fb06326e2d98f6230ced9f71c115f370a4366f1061a2d0d65e1d431504ee3ff4"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.392/Dovo-Studio-Nightly-0.0.9-nightly.392-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
