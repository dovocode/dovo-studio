cask "dovo-studio-nightly" do
  version "0.0.9-nightly.324"
  sha256 "ea5e54d46902461f06fce7b5c4401dbc419a52366deb36eda4fe76c86668e797"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.324/Dovo-Studio-Nightly-0.0.9-nightly.324-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
