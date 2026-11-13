cask "dovo-studio-nightly" do
  version "0.0.9-nightly.868"
  sha256 "b74caabc6dd0e7dca1dd116c572a63a4966e08d9b4fe7aa03f22778012c7f377"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.868/Dovo-Studio-Nightly-0.0.9-nightly.868-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
