cask "dovo-studio-nightly" do
  version "0.0.9-nightly.465"
  sha256 "0139f6f5233384f63381cdad33ed14fe9c9e0f68968615c7b23b10abf29afd4b"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.465/Dovo-Studio-Nightly-0.0.9-nightly.465-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
