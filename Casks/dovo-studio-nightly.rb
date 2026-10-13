cask "dovo-studio-nightly" do
  version "0.0.9-nightly.303"
  sha256 "1a536e76451aca88a580aeb582f24d714f7b22e3f8e88c97c88ade00cf1524bf"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.303/Dovo-Studio-Nightly-0.0.9-nightly.303-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
