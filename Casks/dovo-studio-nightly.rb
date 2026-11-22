cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1043"
  sha256 "d3ba6abecc2dd2932ef67f9a8463928bfe035088fd60de3177a8c0f3a57c4882"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1043/Dovo-Studio-Nightly-0.0.9-nightly.1043-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
