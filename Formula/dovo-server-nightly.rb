class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.917"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.917/Dovo-Server-Nightly-0.0.9-nightly.917-macos-arm64.tar.gz"
      sha256 "9c7432d429c9c28d9f414cb540a8e8ba093ab01767364dafefa4fdfbcb0938d2"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.917/Dovo-Server-Nightly-0.0.9-nightly.917-linux-arm64.tar.gz"
      sha256 "0228ebd38f0dbf4549427833202996e9a6a6b21a38b323b29b3b85f25e36b4d2"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.917/Dovo-Server-Nightly-0.0.9-nightly.917-linux-x64.tar.gz"
      sha256 "edbed1b857a7a5c59c555ffcf2a2c0cc92552720ff244cd3e93d14567ef8a994"
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
