cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1004"
  sha256 "daf11dd2d2d10815c0c650eb86b3decabe21a143eb1720bddf81ee14a4097fc3"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1004/Dovo-Studio-Nightly-0.0.9-nightly.1004-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
