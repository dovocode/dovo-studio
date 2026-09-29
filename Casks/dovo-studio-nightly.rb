cask "dovo-studio-nightly" do
  version "0.0.7-nightly.39"
  sha256 "9ea798e6b05915e70bc903d20da028cbe5b3cad8ea212ad2ab471a8844801919"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.39/Dovo-Studio-Nightly-0.0.7-nightly.39-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
