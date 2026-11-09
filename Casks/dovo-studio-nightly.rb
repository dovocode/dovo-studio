cask "dovo-studio-nightly" do
  version "0.0.9-nightly.753"
  sha256 "7e7f0c0706582bc4457874254e86f1a267b722d4cbd6c5ba0c558ef53b419485"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.753/Dovo-Studio-Nightly-0.0.9-nightly.753-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
