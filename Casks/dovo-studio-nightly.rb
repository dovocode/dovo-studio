cask "dovo-studio-nightly" do
  version "0.0.9-nightly.698"
  sha256 "c7bd5dbd65d85d48640b9dca9d875be78271dac254f6341bf392aa9f9f04234c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.698/Dovo-Studio-Nightly-0.0.9-nightly.698-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
