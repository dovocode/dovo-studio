cask "dovo-studio-nightly" do
  version "0.0.7-nightly.81"
  sha256 "2462bcec4090915a3bef00bd805f2f42b938dd44cec65ae4011026d9f4219c59"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.81/Dovo-Studio-Nightly-0.0.7-nightly.81-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
