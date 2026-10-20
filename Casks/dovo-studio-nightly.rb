cask "dovo-studio-nightly" do
  version "0.0.9-nightly.420"
  sha256 "8776efa623d246384c8174167fb3124ca3eee82393b8342214cc463532899bbf"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.420/Dovo-Studio-Nightly-0.0.9-nightly.420-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
