cask "dovo-studio-nightly" do
  version "0.0.9-nightly.383"
  sha256 "f540e1b9eb8a407761c1e50778e42529ea3c6657e1aa60cc34f857e39f19e145"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.383/Dovo-Studio-Nightly-0.0.9-nightly.383-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
