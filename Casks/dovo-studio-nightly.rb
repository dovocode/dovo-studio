cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1117"
  sha256 "c61263154444b1c61702115c594953b5811873f47b74386642b886754b276753"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1117/Dovo-Studio-Nightly-0.0.9-nightly.1117-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
