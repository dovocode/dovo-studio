cask "dovo-studio-nightly" do
  version "0.0.7-nightly.88"
  sha256 "970bc02cd5ed6ab5d0a92e1d700f4c391a010f3ae69f072a5a0b28e99972ee66"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.88/Dovo-Studio-Nightly-0.0.7-nightly.88-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
