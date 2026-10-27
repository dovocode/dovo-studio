cask "dovo-studio-nightly" do
  version "0.0.9-nightly.550"
  sha256 "cf7d8a696ad3c8c1f226df0a67efc42b2ff93c40075a6eac3f90c399d170b667"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.550/Dovo-Studio-Nightly-0.0.9-nightly.550-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
