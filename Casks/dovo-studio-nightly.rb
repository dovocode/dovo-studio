cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1005"
  sha256 "ced5f9eb1d33ed988e2b16641fb51a6bb876c712444e402911e60bf1717707c3"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1005/Dovo-Studio-Nightly-0.0.9-nightly.1005-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
