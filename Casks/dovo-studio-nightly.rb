cask "dovo-studio-nightly" do
  version "0.0.9-nightly.313"
  sha256 "af5ad98b0e82c096d59042f0405d0ed58bf9928330b4c378672ec9c9ac4370cc"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.313/Dovo-Studio-Nightly-0.0.9-nightly.313-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
