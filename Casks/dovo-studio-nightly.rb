cask "dovo-studio-nightly" do
  version "0.0.9-nightly.230"
  sha256 "1bd97e9653c6f602c7d593f4a89ac59ebd66c3d969baedbd1231d1fb95a95cb7"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.230/Dovo-Studio-Nightly-0.0.9-nightly.230-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
