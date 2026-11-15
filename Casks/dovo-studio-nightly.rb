cask "dovo-studio-nightly" do
  version "0.0.9-nightly.898"
  sha256 "335779ada8daca9bca7d9726777dac4c5e8bd0b34d7cc0e654581c147ed4629f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.898/Dovo-Studio-Nightly-0.0.9-nightly.898-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
