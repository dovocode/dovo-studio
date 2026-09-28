cask "dovo-studio" do
  version "0.0.7"
  sha256 "f74889d0185ff4dbb5e53b177d47403563aa0812c99da7316c078d8deffcfd84"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7/Dovo-Studio-0.0.7-arm64.zip"
  name "Dovo Studio"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio.app"
end
