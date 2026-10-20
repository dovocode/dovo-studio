cask "dovo-studio-nightly" do
  version "0.0.9-nightly.407"
  sha256 "665e1109bb89f47639427800b2b57f7ef3664811739166ba8e61eb1583c52858"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.407/Dovo-Studio-Nightly-0.0.9-nightly.407-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
