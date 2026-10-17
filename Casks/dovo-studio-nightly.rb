cask "dovo-studio-nightly" do
  version "0.0.9-nightly.368"
  sha256 "03e28965c01a195d06ecf3e2c0772bd1b48fc22376931f516186b66920f19587"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.368/Dovo-Studio-Nightly-0.0.9-nightly.368-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
