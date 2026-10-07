cask "dovo-studio-nightly" do
  version "0.0.9-nightly.242"
  sha256 "e84e22da7f8bc0a184779c134d04615c172684750d57ab475c555cf91b164a25"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.242/Dovo-Studio-Nightly-0.0.9-nightly.242-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
