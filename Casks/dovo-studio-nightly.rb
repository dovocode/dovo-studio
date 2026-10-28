cask "dovo-studio-nightly" do
  version "0.0.9-nightly.559"
  sha256 "e03eb10c035a2a7a06a2218b16ad540a8e22b07665ef4ae436302e6ea8a667f4"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.559/Dovo-Studio-Nightly-0.0.9-nightly.559-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
