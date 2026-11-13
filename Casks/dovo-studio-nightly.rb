cask "dovo-studio-nightly" do
  version "0.0.9-nightly.859"
  sha256 "8d599fab422883a3a63976e6c333ba6b89afc2706ec0a9b25c82e47feed2884d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.859/Dovo-Studio-Nightly-0.0.9-nightly.859-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
