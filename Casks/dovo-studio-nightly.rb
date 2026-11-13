cask "dovo-studio-nightly" do
  version "0.0.9-nightly.850"
  sha256 "d686ec4b22180c35300cebe837544aed58dec9ec90ab9c80075193260cc93898"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.850/Dovo-Studio-Nightly-0.0.9-nightly.850-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
