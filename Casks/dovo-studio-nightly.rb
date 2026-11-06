cask "dovo-studio-nightly" do
  version "0.0.9-nightly.711"
  sha256 "f1a95fa553bc9fb59d808a24c8dc5292f6ef85308ba312d59b7428dce05e1588"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.711/Dovo-Studio-Nightly-0.0.9-nightly.711-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
