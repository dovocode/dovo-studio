cask "dovo-studio-nightly" do
  version "0.0.9-nightly.252"
  sha256 "6b8115ad0cb3d318016e16a8a6bc24afeadb5c285fc3bdfc200dc95f2a58966c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.252/Dovo-Studio-Nightly-0.0.9-nightly.252-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
