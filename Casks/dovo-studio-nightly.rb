cask "dovo-studio-nightly" do
  version "0.0.7-nightly.202"
  sha256 "a26aef29adfa45a55bef1e27e010bfc6fc300bab13701c23f8ce6bfa6a733e74"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.202/Dovo-Studio-Nightly-0.0.7-nightly.202-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
