cask "dovo-studio-nightly" do
  version "0.0.9-nightly.334"
  sha256 "6f40bb3c7ac8897153b7ea6a28ba33096e5c71a24ad675a3cdb80fcfbdae5581"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.334/Dovo-Studio-Nightly-0.0.9-nightly.334-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
