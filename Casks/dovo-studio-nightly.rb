cask "dovo-studio-nightly" do
  version "0.0.7-nightly.212"
  sha256 "a3dab963f1ffc8a66e35b310cd4812b24fff4286b1b408091846937eea22d4d1"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.212/Dovo-Studio-Nightly-0.0.7-nightly.212-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
