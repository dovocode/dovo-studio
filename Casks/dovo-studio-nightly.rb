cask "dovo-studio-nightly" do
  version "0.0.7-nightly.48"
  sha256 "53fb3e45b4c908192ae700c85fa016399cf5c90f789d766a272e69792927e9bf"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.48/Dovo-Studio-Nightly-0.0.7-nightly.48-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
