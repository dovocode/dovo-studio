cask "dovo-studio-nightly" do
  version "0.0.9-nightly.387"
  sha256 "f84d9924b06a947f8bbb11d7126615a4a068a60cd042c3e4e4ae45697bdbd180"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.387/Dovo-Studio-Nightly-0.0.9-nightly.387-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
