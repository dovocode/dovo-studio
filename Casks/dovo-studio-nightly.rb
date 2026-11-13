cask "dovo-studio-nightly" do
  version "0.0.9-nightly.849"
  sha256 "dde353c7fc30f5f627beeb522ad5858ebe2548716a5d0dfe7df11319ae3cec63"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.849/Dovo-Studio-Nightly-0.0.9-nightly.849-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
