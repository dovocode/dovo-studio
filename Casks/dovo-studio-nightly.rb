cask "dovo-studio-nightly" do
  version "0.0.9-nightly.677"
  sha256 "859a227b1ba4a2d0c062a675a70d42d17a79919f302d999b0a390c612dc32bc7"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.677/Dovo-Studio-Nightly-0.0.9-nightly.677-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
