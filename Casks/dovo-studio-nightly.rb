cask "dovo-studio-nightly" do
  version "0.0.9-nightly.920"
  sha256 "7ee27ce08d6ba559ec78c891c3fa75d4a6512ca262b78d61fa28b86a9cc97d2d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.920/Dovo-Studio-Nightly-0.0.9-nightly.920-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
