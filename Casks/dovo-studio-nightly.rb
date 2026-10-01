cask "dovo-studio-nightly" do
  version "0.0.7-nightly.110"
  sha256 "f4c1367a067ec7410acd8752e35ed189eceb373137fb13b873c0ed3aa3ee0c8e"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.110/Dovo-Studio-Nightly-0.0.7-nightly.110-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
