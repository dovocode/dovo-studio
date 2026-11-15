class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.896"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.896/Dovo-Server-Nightly-0.0.9-nightly.896-macos-arm64.tar.gz"
      sha256 "c4091767fc23b8df3aede7d19d259a300505859f14b8aa22035719b3a3aba93a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.896/Dovo-Server-Nightly-0.0.9-nightly.896-linux-arm64.tar.gz"
      sha256 "53fa36498860e0a0b1fe28fc550564549b00767699d8d2022daeca2a02114f66"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.896/Dovo-Server-Nightly-0.0.9-nightly.896-linux-x64.tar.gz"
      sha256 "967efb4580dbf1f52eb89ef1c4901aa10477c4c63f7df1686d3f9afe843d28a7"
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
