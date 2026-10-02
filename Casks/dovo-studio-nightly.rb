cask "dovo-studio-nightly" do
  version "0.0.7-nightly.142"
  sha256 "0156cfebeeb66554f00d278def6e7258428d9d3c3cf7113b172bc1a64ec7e649"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.142/Dovo-Studio-Nightly-0.0.7-nightly.142-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
