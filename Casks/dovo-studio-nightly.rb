cask "dovo-studio-nightly" do
  version "0.0.9-nightly.902"
  sha256 "f6feaa61853a8f7292af0da87c0687d14687e8209a58213aab71039c011808c0"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.902/Dovo-Studio-Nightly-0.0.9-nightly.902-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
