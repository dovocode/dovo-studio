cask "dovo-studio-nightly" do
  version "0.0.9-nightly.613"
  sha256 "f94810d1178e7371046aff1606a356c9dad36b35c33508b3aa2f36080734e1b1"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.613/Dovo-Studio-Nightly-0.0.9-nightly.613-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
