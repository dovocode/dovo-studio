cask "dovo-studio-nightly" do
  version "0.0.9-nightly.858"
  sha256 "3019114b42463e42a8cb9e40fb949d64dce42da259b5fac720f250b61f0514b0"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.858/Dovo-Studio-Nightly-0.0.9-nightly.858-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
