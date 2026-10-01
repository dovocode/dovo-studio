cask "dovo-studio-nightly" do
  version "0.0.7-nightly.114"
  sha256 "bb81b24d1e6061b35088e1a05e7c0897f406affcc620b71b130562f1f7fe55cc"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.114/Dovo-Studio-Nightly-0.0.7-nightly.114-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
