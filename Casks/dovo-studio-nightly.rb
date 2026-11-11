cask "dovo-studio-nightly" do
  version "0.0.9-nightly.815"
  sha256 "e94c23bbc33c3edc1a76061ba450d238537c327ea7b0cec44ea60fec3d79de3c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.815/Dovo-Studio-Nightly-0.0.9-nightly.815-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
