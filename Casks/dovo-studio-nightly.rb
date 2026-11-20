cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1014"
  sha256 "c355fcfee70e51de63040e8fa44531331044e21d8716b1ba4ba0c2d47df164e6"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1014/Dovo-Studio-Nightly-0.0.9-nightly.1014-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
