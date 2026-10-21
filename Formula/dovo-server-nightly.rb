class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.443"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.443/Dovo-Server-Nightly-0.0.9-nightly.443-macos-arm64.tar.gz"
      sha256 "bb8490307c36ceea9b0c8d151f5a9d33ef415e92539188d9707172d6a321a639"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.443/Dovo-Server-Nightly-0.0.9-nightly.443-linux-arm64.tar.gz"
      sha256 "2d825758c72d51151b3bd91b2de9563f9e3a3a444ba1ea3aff2aa51f20ed7013"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.443/Dovo-Server-Nightly-0.0.9-nightly.443-linux-x64.tar.gz"
      sha256 "fad5832dbd034adeadf7630459b42365db7680802714afa3966f04b30d5cd613"
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
