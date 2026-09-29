cask "dovo-studio-nightly" do
  version "0.0.7-nightly.64"
  sha256 "04ada0c0ce43283d0d0eba2a9f8ef2f7448b21f92e125a53a3c12fb4886cf951"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.64/Dovo-Studio-Nightly-0.0.7-nightly.64-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
