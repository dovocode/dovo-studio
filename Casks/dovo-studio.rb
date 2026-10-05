cask "dovo-studio" do
  version "0.0.8"
  sha256 "5950d82385b4a5a56924d5792e178e50ba3f3339f4e215dea03f646f9bb5c8b4"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.8/Dovo-Studio-0.0.8-arm64.zip"
  name "Dovo Studio"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio.app"
end
