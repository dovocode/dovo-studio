cask "dovo-studio-nightly" do
  version "0.0.9-nightly.234"
  sha256 "73598784a116dae3b0447dfa4ec893d75246e2a08be8a78ee7516063af00d407"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.234/Dovo-Studio-Nightly-0.0.9-nightly.234-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
