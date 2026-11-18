cask "dovo-studio-nightly" do
  version "0.0.9-nightly.964"
  sha256 "dcccec73d76eb8dc11beaac25ad8678b2361154a71e2b230c6568c668b41a590"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.964/Dovo-Studio-Nightly-0.0.9-nightly.964-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
