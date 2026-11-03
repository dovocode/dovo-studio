class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.687"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.687/Dovo-Server-Nightly-0.0.9-nightly.687-macos-arm64.tar.gz"
      sha256 "d067b2fceefd14a72c76a2dcadb9fff252a679355c6d84b69822406756f1070c"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.687/Dovo-Server-Nightly-0.0.9-nightly.687-linux-arm64.tar.gz"
      sha256 "3c2debe019e84dc469e93b6371675a1a49b8b38a88c45ad8dc4937b71b9fea43"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.687/Dovo-Server-Nightly-0.0.9-nightly.687-linux-x64.tar.gz"
      sha256 "86ee30a28e0b11fe4d19bbf59646d1bd27c3db1e9e50f02bd8198cc1a8f1dc01"
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
