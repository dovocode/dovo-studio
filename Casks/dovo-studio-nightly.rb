cask "dovo-studio-nightly" do
  version "0.0.7-nightly.68"
  sha256 "4cc8e8a892dc9c54390961a5982780df1bcd6d8e2aa860752b2d4fed4c779c7e"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.68/Dovo-Studio-Nightly-0.0.7-nightly.68-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
