cask "dovo-studio-nightly" do
  version "0.0.9-nightly.233"
  sha256 "b2b03f226a73fc6aa1ebd5fb538a3f611330125dc3c2a1062428543846edf512"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.233/Dovo-Studio-Nightly-0.0.9-nightly.233-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
