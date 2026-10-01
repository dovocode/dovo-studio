cask "dovo-studio-nightly" do
  version "0.0.7-nightly.137"
  sha256 "ef54eb9a737e679b0cc3866dc9fa39e354aceb4414222b7329d397d00264c125"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.137/Dovo-Studio-Nightly-0.0.7-nightly.137-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
