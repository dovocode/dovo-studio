cask "dovo-studio-nightly" do
  version "0.0.7-nightly.163"
  sha256 "d7980cdf30115bdc8217f5091f8816a4924dbaabeab66b1c13d7dff17a1e7138"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.163/Dovo-Studio-Nightly-0.0.7-nightly.163-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
