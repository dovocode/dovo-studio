class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.711"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.711/Dovo-Server-Nightly-0.0.9-nightly.711-macos-arm64.tar.gz"
      sha256 "e675419bc976dea0d1a0b601c18b96bc2e57f1bdd1bec7067e5df85d23df4348"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.711/Dovo-Server-Nightly-0.0.9-nightly.711-linux-arm64.tar.gz"
      sha256 "f9ceb692d533d780c6a8949168d105b8bda87aa7758bb515986c3039b43938bc"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.711/Dovo-Server-Nightly-0.0.9-nightly.711-linux-x64.tar.gz"
      sha256 "13c02f189c57c64dbaad4373bcd9fce1d6d5d27713611d4c0bc401648f65360d"
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
