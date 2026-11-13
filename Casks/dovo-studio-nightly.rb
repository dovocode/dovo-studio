cask "dovo-studio-nightly" do
  version "0.0.9-nightly.851"
  sha256 "f1fde8dc3a3597cf8f79ba1dcc45f0b70ab595f3f716c8ad170b1d8f1fef30f7"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.851/Dovo-Studio-Nightly-0.0.9-nightly.851-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
