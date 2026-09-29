cask "dovo-studio-nightly" do
  version "0.0.7-nightly.54"
  sha256 "0d44812a71d046de78c568c499c1cbb9c8d58b42a74d032958d66390c08d5b92"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.54/Dovo-Studio-Nightly-0.0.7-nightly.54-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
