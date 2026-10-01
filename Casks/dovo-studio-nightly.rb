cask "dovo-studio-nightly" do
  version "0.0.7-nightly.139"
  sha256 "ccf3ed0f6c16de79faf761a082c2a01714368a394715636e639d99946fa00a2f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.139/Dovo-Studio-Nightly-0.0.7-nightly.139-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
