cask "dovo-studio-nightly" do
  version "0.0.9-nightly.414"
  sha256 "ab02b96e599e1d5196f2a6e942c08c84ff9a01670365d8f55cd40423ddf4a538"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.414/Dovo-Studio-Nightly-0.0.9-nightly.414-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
