cask "dovo-studio" do
  version "0.0.4"
  sha256 "a4171f7bdcc5b47814ead588da7a72c057515522a07ce303b06cc192c721a4dd"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.4/Dovo-Studio-0.0.4-arm64.zip"
  name "Dovo Studio"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio.app"
end
