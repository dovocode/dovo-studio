cask "dovo-studio-nightly" do
  version "0.0.9-nightly.567"
  sha256 "b68ae098af647b1fe1959de3eef5888d3b5937129388eb8977003d4d17638627"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.567/Dovo-Studio-Nightly-0.0.9-nightly.567-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
