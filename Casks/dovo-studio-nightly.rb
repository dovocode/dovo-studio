cask "dovo-studio-nightly" do
  version "0.0.9-nightly.262"
  sha256 "d3b35542cd7df3163954434cee92e21240c56b4334766e637b64e10ffeb3014c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.262/Dovo-Studio-Nightly-0.0.9-nightly.262-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
