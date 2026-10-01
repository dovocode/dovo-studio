cask "dovo-studio-nightly" do
  version "0.0.7-nightly.131"
  sha256 "cd7623cdef274d2125c15c346bf7e8e4d9f8f7a6c31e8ddd8fcb9a2ab27c75a2"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.131/Dovo-Studio-Nightly-0.0.7-nightly.131-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
