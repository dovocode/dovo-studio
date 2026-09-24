cask "dovo-studio" do
  version "0.0.2"
  sha256 "5f0fba68bc3bde522622e93b4f16cf0053970296bd25ce03145387ea5b261b58"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.2/Dovo-Studio-0.0.2-arm64.zip"
  name "Dovo Studio"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio.app"
end
