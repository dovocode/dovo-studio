class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.559"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.559/Dovo-Server-Nightly-0.0.9-nightly.559-macos-arm64.tar.gz"
      sha256 "d9c01704405419993b68c8fdbd29b3a866fecb14e26f7327dfb2dd6d5bea3457"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.559/Dovo-Server-Nightly-0.0.9-nightly.559-linux-arm64.tar.gz"
      sha256 "2149f6d022ac1bdb73072aa3c9432818f5e688dc1a6a42710e0e5b16fb9b8f95"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.559/Dovo-Server-Nightly-0.0.9-nightly.559-linux-x64.tar.gz"
      sha256 "0495d57f61bcaf0899d563423d984e7b5fda41b71028a8fcc5cb47a0f1870a5e"
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
