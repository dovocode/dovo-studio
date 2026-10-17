cask "dovo-studio-nightly" do
  version "0.0.9-nightly.371"
  sha256 "eaef95cf904decdd97bb81ff53dfd1341a56276e83963bf5172f5c92de040c28"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.371/Dovo-Studio-Nightly-0.0.9-nightly.371-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
