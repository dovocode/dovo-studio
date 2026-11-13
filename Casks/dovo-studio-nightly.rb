cask "dovo-studio-nightly" do
  version "0.0.9-nightly.856"
  sha256 "4ad9afb661cac0f553fccfc8ea879e54ac714e0af4c2797db6e1bbcebe1c122b"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.856/Dovo-Studio-Nightly-0.0.9-nightly.856-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
