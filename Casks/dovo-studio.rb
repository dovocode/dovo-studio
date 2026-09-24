cask "dovo-studio" do
  version "0.0.3"
  sha256 "9e8793fa9dd99c06ef30ce7d538ad55f377447fa6d6192383fd92db6fc177c32"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.3/Dovo-Studio-0.0.3-arm64.zip"
  name "Dovo Studio"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio.app"
end
