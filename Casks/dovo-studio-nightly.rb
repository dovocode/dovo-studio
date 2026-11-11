cask "dovo-studio-nightly" do
  version "0.0.9-nightly.797"
  sha256 "fbd676af2e6ae7b64858dce55cb4f2160ffcdd16e153d8d38b362092d6dd7f9d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.797/Dovo-Studio-Nightly-0.0.9-nightly.797-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
