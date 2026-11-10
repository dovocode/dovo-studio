cask "dovo-studio-nightly" do
  version "0.0.9-nightly.772"
  sha256 "cbc619a65f1171eb33df74fe2b7325d9faf214da5ec94bec1605d84f06462107"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.772/Dovo-Studio-Nightly-0.0.9-nightly.772-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
