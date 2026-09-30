class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.107"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.107/Dovo-Server-Nightly-0.0.7-nightly.107-macos-arm64.tar.gz"
      sha256 "45351d7eddf79fa6f4d9bd8fd854dc3c03c4ce9b78b6156bd41a58bef1797f20"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.107/Dovo-Server-Nightly-0.0.7-nightly.107-linux-arm64.tar.gz"
      sha256 "5256a7ae8087e7f0969cba35a2ea8a03c33556a5bb20c24c813b6fdff4a7e294"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.107/Dovo-Server-Nightly-0.0.7-nightly.107-linux-x64.tar.gz"
      sha256 "919a603dde3cb9958e05b769519bf4e307d68c2a1ab3cb3483c04e5fc4619cd4"
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
