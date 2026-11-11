cask "dovo-studio-nightly" do
  version "0.0.9-nightly.801"
  sha256 "40cfc3a30494124025867f8f5c49fdef21d4fd1de387acd1defa94b57d12431a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.801/Dovo-Studio-Nightly-0.0.9-nightly.801-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
