cask "dovo-studio-nightly" do
  version "0.0.9-nightly.647"
  sha256 "b74e9bb1fbd6dc27854ede06300f1b60c4c83a969f262af76e5ca488a2050c88"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.647/Dovo-Studio-Nightly-0.0.9-nightly.647-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
