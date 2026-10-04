cask "dovo-studio-nightly" do
  version "0.0.7-nightly.205"
  sha256 "42d79974881d706ae8a71f0bcd9aa6d1e9292c7e2b564edfdd0ada4bcec051cd"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.205/Dovo-Studio-Nightly-0.0.7-nightly.205-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
