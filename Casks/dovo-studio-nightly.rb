cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1040"
  sha256 "4c754b52b0709421c25d578a39931d37e0d2a8131f89b305ce0e35e3c1a16dee"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1040/Dovo-Studio-Nightly-0.0.9-nightly.1040-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
