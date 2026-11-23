cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1067"
  sha256 "74a72467635e94e7f010522fae4f8fc33d6f39c82069df6c5bae99dee815e333"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1067/Dovo-Studio-Nightly-0.0.9-nightly.1067-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
