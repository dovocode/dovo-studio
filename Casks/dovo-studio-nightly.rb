cask "dovo-studio-nightly" do
  version "0.0.9-nightly.283"
  sha256 "e268bede31c157282518b8a9329120054a69cbe8b647676db13f2f053bfcf517"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.283/Dovo-Studio-Nightly-0.0.9-nightly.283-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
