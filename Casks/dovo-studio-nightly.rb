cask "dovo-studio-nightly" do
  version "0.0.9-nightly.469"
  sha256 "c114185fb9c586d1b0f71d9bbd765cd8d831f2574ef8632636669379fea0e3d4"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.469/Dovo-Studio-Nightly-0.0.9-nightly.469-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
