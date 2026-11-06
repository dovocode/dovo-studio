cask "dovo-studio-nightly" do
  version "0.0.9-nightly.718"
  sha256 "1f26bca62efc54682373ef7c72659668042242e345adf0d02d83ab7b662aaccb"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.718/Dovo-Studio-Nightly-0.0.9-nightly.718-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
