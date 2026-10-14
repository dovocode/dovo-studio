cask "dovo-studio-nightly" do
  version "0.0.9-nightly.311"
  sha256 "bf22d11a413fd2f1a7c137d03e341cc783386a456d40be3facf535ae33cf83f2"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.311/Dovo-Studio-Nightly-0.0.9-nightly.311-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
