cask "dovo-studio-nightly" do
  version "0.0.9-nightly.604"
  sha256 "232137326eea8a9d89944b5956b79ab300da74d919c9549e589a86308e2998ab"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.604/Dovo-Studio-Nightly-0.0.9-nightly.604-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
