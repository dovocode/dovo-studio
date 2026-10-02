class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.167"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.167/Dovo-Server-Nightly-0.0.7-nightly.167-macos-arm64.tar.gz"
      sha256 "e6472badd5512592b34ab7c177d33b9e058ec50cd9f2e27fd2219a8ce5ae8b9f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.167/Dovo-Server-Nightly-0.0.7-nightly.167-linux-arm64.tar.gz"
      sha256 "e0b50a3d1d2cd3664a0e235fc39d3fe1514dd0f5da2ad626f3d8b2a61d48026c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.167/Dovo-Server-Nightly-0.0.7-nightly.167-linux-x64.tar.gz"
      sha256 "71d80ef937b93262b221331293696f9509621a460f9157db613be82eb0edc7b5"
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
