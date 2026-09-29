cask "dovo-studio-nightly" do
  version "0.0.7-nightly.61"
  sha256 "a5591c8314320db8d250bb91e956a918a593fa0f3380051ac5cfff8f22ee6cdb"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.61/Dovo-Studio-Nightly-0.0.7-nightly.61-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
