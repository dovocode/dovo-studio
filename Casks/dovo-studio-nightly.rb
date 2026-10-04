cask "dovo-studio-nightly" do
  version "0.0.7-nightly.214"
  sha256 "8701a84b99962c63cdf84f40198d77b40b76f3085f62173998e40b658fbfee68"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.214/Dovo-Studio-Nightly-0.0.7-nightly.214-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
