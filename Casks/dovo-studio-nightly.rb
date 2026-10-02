cask "dovo-studio-nightly" do
  version "0.0.7-nightly.154"
  sha256 "e306a4a9316aa6498fc506aeafb239f237e32aecb3c5477c731b8a713f8f3d70"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.154/Dovo-Studio-Nightly-0.0.7-nightly.154-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
