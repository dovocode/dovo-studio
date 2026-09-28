cask "dovo-studio" do
  version "0.0.6"
  sha256 "75d5862dc9f8bfa853b691028617466fd4af183e135a2f53a329f3a0dd9b2d13"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.6/Dovo-Studio-0.0.6-arm64.zip"
  name "Dovo Studio"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio.app"
end
