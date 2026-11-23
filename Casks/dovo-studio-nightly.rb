cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1058"
  sha256 "637627eeef4392e1e190eb8d1b4e0e2c1655c77fe6c4f45c2984695afab76770"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1058/Dovo-Studio-Nightly-0.0.9-nightly.1058-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
