cask "dovo-studio-nightly" do
  version "0.0.7-nightly.190"
  sha256 "6f903fe74ef72c17160b63ee67be334f0081bdcdc030388ab781b3714d5edc85"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.190/Dovo-Studio-Nightly-0.0.7-nightly.190-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
