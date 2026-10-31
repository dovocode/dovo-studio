cask "dovo-studio-nightly" do
  version "0.0.9-nightly.611"
  sha256 "8dc1b21c76ecc3082b4410620b03b0ca7416d4778f966edaff5bb97d7ef870f5"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.611/Dovo-Studio-Nightly-0.0.9-nightly.611-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
