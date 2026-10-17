cask "dovo-studio-nightly" do
  version "0.0.9-nightly.375"
  sha256 "8e2831122b2e8eec02458eb40242b6392ae33b7d5d11354962c44bba6d858339"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.375/Dovo-Studio-Nightly-0.0.9-nightly.375-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
