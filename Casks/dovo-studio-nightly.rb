cask "dovo-studio-nightly" do
  version "0.0.7-nightly.55"
  sha256 "47d0e8a6be7e647a22d96dbe9fabd85db1ebd0812c17fcd7f419b1cfada00137"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.55/Dovo-Studio-Nightly-0.0.7-nightly.55-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
