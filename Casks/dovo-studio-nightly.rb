cask "dovo-studio-nightly" do
  version "0.0.7-nightly.222"
  sha256 "b0d3c8b9e3eefb1fd98c8d51c8786e41a92bc57c16808776ad25bff99e408c8e"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.222/Dovo-Studio-Nightly-0.0.7-nightly.222-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
