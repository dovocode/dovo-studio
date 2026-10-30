cask "dovo-studio-nightly" do
  version "0.0.9-nightly.594"
  sha256 "591e6e7581dfb414a90bda1cbdd73fe40ff46de9094ce164e6d32f9b02fb2601"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.594/Dovo-Studio-Nightly-0.0.9-nightly.594-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
