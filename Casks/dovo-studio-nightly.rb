cask "dovo-studio-nightly" do
  version "0.0.9-nightly.633"
  sha256 "efd26a0f3978a5c2d9acd31662bef6fc03d33b678bd4b8fd0e9cfdfd797da757"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.633/Dovo-Studio-Nightly-0.0.9-nightly.633-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
