cask "dovo-studio-nightly" do
  version "0.0.9-nightly.254"
  sha256 "ea43d1690f02004502c17513e6aa569873cf0b2e245ec57f400bfc31335e1321"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.254/Dovo-Studio-Nightly-0.0.9-nightly.254-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
