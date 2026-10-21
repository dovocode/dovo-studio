class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.422"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.422/Dovo-Server-Nightly-0.0.9-nightly.422-macos-arm64.tar.gz"
      sha256 "851ba4d6c11d9fcb88e512495b3d69a45d71755f48b02d9b8d3df4fefc5e554a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.422/Dovo-Server-Nightly-0.0.9-nightly.422-linux-arm64.tar.gz"
      sha256 "3df181d38d272d2f63585eee23a5cd7f80b2bb42a03337ade344d911512da2aa"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.422/Dovo-Server-Nightly-0.0.9-nightly.422-linux-x64.tar.gz"
      sha256 "fb62336d6f01d18918d43e1a2d1449b2d1ed8d447a32af48d183967b8dae9bd1"
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
