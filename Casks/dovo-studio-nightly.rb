cask "dovo-studio-nightly" do
  version "0.0.9-nightly.907"
  sha256 "a88c14ad139ce40eea92bd4b7f764ab867e06846d5270f15b44a79cd5bc00f9f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.907/Dovo-Studio-Nightly-0.0.9-nightly.907-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
