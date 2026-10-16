cask "dovo-studio-nightly" do
  version "0.0.9-nightly.347"
  sha256 "3761295d82c5e8c1f64f455efbc2465c152419df211c5802b34868934bc59467"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.347/Dovo-Studio-Nightly-0.0.9-nightly.347-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
