cask "dovo-studio-nightly" do
  version "0.0.9-nightly.256"
  sha256 "23a7ad6cbaba003a49b32c7950d8a3998547e623b54cda07c63486372dd96e48"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.256/Dovo-Studio-Nightly-0.0.9-nightly.256-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
