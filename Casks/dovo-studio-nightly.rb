cask "dovo-studio-nightly" do
  version "0.0.7-nightly.223"
  sha256 "271747de72ed0c029de7ac24a88fbc91fc94787defb8633050b8e2349f166baf"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.223/Dovo-Studio-Nightly-0.0.7-nightly.223-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
