cask "dovo-studio-nightly" do
  version "0.0.7-nightly.221"
  sha256 "0cdd88e6f2c4524216c34f8a9b8e638b682e4c2fa523f6b17332cdfd5b4c86f7"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.221/Dovo-Studio-Nightly-0.0.7-nightly.221-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
