class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.168"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.168/Dovo-Server-Nightly-0.0.7-nightly.168-macos-arm64.tar.gz"
      sha256 "4fb67171eef8e45106851116fd4fb63c5879e701544c7a73c518ad1a2a66a667"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.168/Dovo-Server-Nightly-0.0.7-nightly.168-linux-arm64.tar.gz"
      sha256 "abaace5b6e42cd5ccdb7203d6af94a80f5ff4c59b062cf7a02e36be1c5d463a4"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.168/Dovo-Server-Nightly-0.0.7-nightly.168-linux-x64.tar.gz"
      sha256 "88f0c9e0890faac578a41b24eb8d75e1546eed3999ff77dea4d62687495db470"
    end
  end
  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/dovo-server-nightly"
  end
  def caveats
    <<~EOS
      Configure: dovo-server-nightly setup
      Start:     dovo-server-nightly start
      Pair:      dovo-server-nightly pair
      Finish active work and stop before upgrading, then start again.
      Data is stored in ~/.dovo by default and is never removed by uninstall.
      This formula does not register an automatic login service.
    EOS
  end
  test do
    assert_match "Usage:", shell_output("#{bin}/dovo-server-nightly --help")
  end
end
