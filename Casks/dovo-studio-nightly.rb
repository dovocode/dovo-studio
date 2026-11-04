cask "dovo-studio-nightly" do
  version "0.0.9-nightly.697"
  sha256 "9f58456fb3a4319e6ed172ebba3633aeca03916a161ad5de7ab1db11e56d3b31"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.697/Dovo-Studio-Nightly-0.0.9-nightly.697-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
