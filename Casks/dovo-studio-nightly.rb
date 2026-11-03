cask "dovo-studio-nightly" do
  version "0.0.9-nightly.678"
  sha256 "560f59ca0dfa924f8b5884338c154402fbe894666b0d9990deeb2dd04a316488"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.678/Dovo-Studio-Nightly-0.0.9-nightly.678-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
