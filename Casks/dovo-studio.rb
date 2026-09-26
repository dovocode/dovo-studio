cask "dovo-studio" do
  version "0.0.5"
  sha256 "1e45b21b42500af4236424dc10442fa3aa24b2a74ad351cff6d523e14e32cf89"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.5/Dovo-Studio-0.0.5-arm64.zip"
  name "Dovo Studio"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio.app"
end
