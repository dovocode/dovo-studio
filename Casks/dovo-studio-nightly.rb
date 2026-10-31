cask "dovo-studio-nightly" do
  version "0.0.9-nightly.601"
  sha256 "a3882c83850cde2faad71f049e50a57b41aa325692d0837f70c5538e6dbc2c3a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.601/Dovo-Studio-Nightly-0.0.9-nightly.601-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
