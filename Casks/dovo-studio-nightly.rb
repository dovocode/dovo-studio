cask "dovo-studio-nightly" do
  version "0.0.9-nightly.888"
  sha256 "71f1328cd13b7eaca715f1d447051bc2f5364b88d7ad53ca59840c39353d6bd1"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.888/Dovo-Studio-Nightly-0.0.9-nightly.888-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
