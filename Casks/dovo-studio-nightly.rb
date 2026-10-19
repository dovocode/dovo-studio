cask "dovo-studio-nightly" do
  version "0.0.9-nightly.394"
  sha256 "f1d2dd7c7e1ab78401af7158e503128b15b40a812e71824fdf7804ce2ef1585f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.394/Dovo-Studio-Nightly-0.0.9-nightly.394-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
