cask "dovo-studio-nightly" do
  version "0.0.9-nightly.244"
  sha256 "7fcfa45dcf04ce078c887579a8ec73eb8b6adca9b7ecc786414b63b2a2ba33fc"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.244/Dovo-Studio-Nightly-0.0.9-nightly.244-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
