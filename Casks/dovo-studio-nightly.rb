cask "dovo-studio-nightly" do
  version "0.0.7-nightly.106"
  sha256 "ab2ef4383ce240293a5a99e6138eb625d64597a6ec616aca2fe604aed3414105"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.106/Dovo-Studio-Nightly-0.0.7-nightly.106-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
