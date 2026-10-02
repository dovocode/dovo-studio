cask "dovo-studio-nightly" do
  version "0.0.7-nightly.162"
  sha256 "8bbb19691392231b3f7d5c7918eaeadfaa7be4c2d030eb0edd639b1c87262fff"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.162/Dovo-Studio-Nightly-0.0.7-nightly.162-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
