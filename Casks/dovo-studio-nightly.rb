cask "dovo-studio-nightly" do
  version "0.0.9-nightly.926"
  sha256 "54d14dd0045e0cefa58b5a7cc8fa3924c59d69c00898930e511dc1856a3e819a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.926/Dovo-Studio-Nightly-0.0.9-nightly.926-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
