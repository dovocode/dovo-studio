cask "dovo-studio-nightly" do
  version "0.0.9-nightly.539"
  sha256 "1261a63fb22768b9737181687434607b31973964b2eba40b004554ed05a49474"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.539/Dovo-Studio-Nightly-0.0.9-nightly.539-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
