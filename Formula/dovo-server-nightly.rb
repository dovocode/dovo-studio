class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.102"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.102/Dovo-Server-Nightly-0.0.7-nightly.102-macos-arm64.tar.gz"
      sha256 "4d298ee5be2543c31a132b59a1c9d7fd723fc986dfdcb8976202b59cd6e30b3b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.102/Dovo-Server-Nightly-0.0.7-nightly.102-linux-arm64.tar.gz"
      sha256 "d451b3cedae2c9c7cc1d0b6462ac0dc0bbe45ec4d031e3adf358b980a744b6d4"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.102/Dovo-Server-Nightly-0.0.7-nightly.102-linux-x64.tar.gz"
      sha256 "0ebb23213058653e1a3c1ad5e667c1ff0e30cc0a8471fd7071f2c8fcba76c4ff"
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
