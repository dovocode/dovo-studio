cask "dovo-studio-nightly" do
  version "0.0.9-nightly.764"
  sha256 "cc50b4e11d1c1273554d18f761059d992f63aa6d9f93cda64dfd2b5d29921263"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.764/Dovo-Studio-Nightly-0.0.9-nightly.764-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
