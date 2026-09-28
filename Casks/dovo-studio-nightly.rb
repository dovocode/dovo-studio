cask "dovo-studio-nightly" do
  version "0.0.7-nightly.25"
  sha256 "fb3686fd48a5b941972d8fd5d48c331bd3e5edf87731eeb80b0c93d9dec341d8"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.25/Dovo-Studio-Nightly-0.0.7-nightly.25-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
