cask "dovo-studio-nightly" do
  version "0.0.9-nightly.561"
  sha256 "59ff73803eef1736f9545ce879abc2011ac933e43a5f48cf52b63d33d3b9e8dc"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.561/Dovo-Studio-Nightly-0.0.9-nightly.561-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
