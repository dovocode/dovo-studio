cask "dovo-studio-nightly" do
  version "0.0.7-nightly.100"
  sha256 "e82ab2b42aa345b97fc4ecc9190953c0036bec596304544e5394d1b7254564d5"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.100/Dovo-Studio-Nightly-0.0.7-nightly.100-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
