cask "dovo-studio-nightly" do
  version "0.0.9-nightly.895"
  sha256 "c65a2c70db3e312f7fd689e30a450aeb61dafd945166d275eb21a17bfb160d95"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.895/Dovo-Studio-Nightly-0.0.9-nightly.895-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
