cask "dovo-studio-nightly" do
  version "0.0.9-nightly.579"
  sha256 "9d78f62b0f77bcec7ad89e78e6f40b66e93b3794f8b84b90647a0ce234a44a75"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.579/Dovo-Studio-Nightly-0.0.9-nightly.579-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
