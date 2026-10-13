cask "dovo-studio-nightly" do
  version "0.0.9-nightly.305"
  sha256 "af315de56890b4b33b39816ff57b7ab86b8a2fdb4460f6d4e8c91b9840e37e45"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.305/Dovo-Studio-Nightly-0.0.9-nightly.305-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
