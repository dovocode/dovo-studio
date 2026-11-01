cask "dovo-studio-nightly" do
  version "0.0.9-nightly.625"
  sha256 "8dd07c1d81ed3ec7100ac238cccf73c6cf0194d17781b12744af8c09a6cd3381"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.625/Dovo-Studio-Nightly-0.0.9-nightly.625-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
