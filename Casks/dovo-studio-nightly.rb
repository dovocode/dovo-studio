cask "dovo-studio-nightly" do
  version "0.0.7-nightly.56"
  sha256 "78783fb3c1a309f91a6809e41fafa51401564562a3f930144f86483fd5f63028"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.56/Dovo-Studio-Nightly-0.0.7-nightly.56-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
