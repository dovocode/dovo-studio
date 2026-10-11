cask "dovo-studio-nightly" do
  version "0.0.9-nightly.281"
  sha256 "c2642b13469bf15472290d07bc972ec68514dd893332d2df182dd7ec86c74f9d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.281/Dovo-Studio-Nightly-0.0.9-nightly.281-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
