cask "dovo-studio-nightly" do
  version "0.0.7-nightly.182"
  sha256 "d1ba73cfebbe095dabcaf89d5fd97e7842e1f97de54419612df285c141406fff"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.182/Dovo-Studio-Nightly-0.0.7-nightly.182-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
