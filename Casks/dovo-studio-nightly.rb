cask "dovo-studio-nightly" do
  version "0.0.9-nightly.714"
  sha256 "7bf5a0ee7e830e3e8845aa717c0de02940010100968fdafe76d8642d016eae05"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.714/Dovo-Studio-Nightly-0.0.9-nightly.714-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
