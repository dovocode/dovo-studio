cask "dovo-studio-nightly" do
  version "0.0.9-nightly.396"
  sha256 "e5abddeebfe30d6ed8926354ddbca84409ff3840d2d3a01343e2a7baa0038f14"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.396/Dovo-Studio-Nightly-0.0.9-nightly.396-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
