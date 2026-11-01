cask "dovo-studio-nightly" do
  version "0.0.9-nightly.636"
  sha256 "6eabd49c103c76344987a30e832c35506c51ec34b1bf765abac7da2c1e9dc0f1"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.636/Dovo-Studio-Nightly-0.0.9-nightly.636-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
