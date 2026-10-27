cask "dovo-studio-nightly" do
  version "0.0.9-nightly.537"
  sha256 "8126cbd8bf073fa9be5b3d7de2ca4a0f4e6a65afcf3bc82ef102b59add06e850"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.537/Dovo-Studio-Nightly-0.0.9-nightly.537-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
