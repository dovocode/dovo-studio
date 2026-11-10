class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.767"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.767/Dovo-Server-Nightly-0.0.9-nightly.767-macos-arm64.tar.gz"
      sha256 "6682d5087186e0e1eac7d8279f74a967fd14fa63f485b1426d039413d22af3bb"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.767/Dovo-Server-Nightly-0.0.9-nightly.767-linux-arm64.tar.gz"
      sha256 "207fe2931c90f56d5abfd4add45e4b752be11dc8466ff9c9fb7f193945e6c09e"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.767/Dovo-Server-Nightly-0.0.9-nightly.767-linux-x64.tar.gz"
      sha256 "4d1b7ef5295ca3ca657b1823994d7c8fdb8f6a3ff3f4bb5b8756e24d1d5b9669"
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
