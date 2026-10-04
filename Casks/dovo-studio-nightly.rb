cask "dovo-studio-nightly" do
  version "0.0.7-nightly.204"
  sha256 "210e7689fee919d92ecb3469ead27dddaef256f03751165d9a86bad6dd21e5c7"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.204/Dovo-Studio-Nightly-0.0.7-nightly.204-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
