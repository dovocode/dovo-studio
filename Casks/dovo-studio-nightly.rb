cask "dovo-studio-nightly" do
  version "0.0.9-nightly.917"
  sha256 "e948d007f04492bf701619f3b95a2b248042e937cd11c6c2e6f0a53e042eb66d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.917/Dovo-Studio-Nightly-0.0.9-nightly.917-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
