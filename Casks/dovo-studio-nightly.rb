cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1087"
  sha256 "7ba12458a9ef7d564d026d0090f8d4c8c219c1da61f91996c5528be0ea123e38"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1087/Dovo-Studio-Nightly-0.0.9-nightly.1087-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
