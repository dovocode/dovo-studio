cask "dovo-studio-nightly" do
  version "0.0.9-nightly.847"
  sha256 "1eb70d34b974c8075e59970af95174b4e379dd50be4b635977b6bd3b3ee0cc0e"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.847/Dovo-Studio-Nightly-0.0.9-nightly.847-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
