cask "dovo-studio-nightly" do
  version "0.0.7-nightly.184"
  sha256 "7235db4820e024c0403729429e220f82ba34eb4e17fe7b1d1f54d9f4814c27cb"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.184/Dovo-Studio-Nightly-0.0.7-nightly.184-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
