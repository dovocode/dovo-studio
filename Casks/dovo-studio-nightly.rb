cask "dovo-studio-nightly" do
  version "0.0.9-nightly.862"
  sha256 "a234e2d4bcc4127344a81e08e01bcff4c2d09cf594b0de7fd2c8809db6edac4a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.862/Dovo-Studio-Nightly-0.0.9-nightly.862-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
