cask "dovo-studio-nightly" do
  version "0.0.9-nightly.301"
  sha256 "cc01bb344c5d07dd0c760cd75ef605395536d782f4ad90e6d8e7dd0dbe43696f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.301/Dovo-Studio-Nightly-0.0.9-nightly.301-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
