class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.293"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.293/Dovo-Server-Nightly-0.0.9-nightly.293-macos-arm64.tar.gz"
      sha256 "69d63c62bc1cc08d05ba5a73635697f772d17edb568ac0e8dcd1f8dffe88ef04"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.293/Dovo-Server-Nightly-0.0.9-nightly.293-linux-arm64.tar.gz"
      sha256 "40273e82bd88fd8694db1ab206a61a134e8b9f726cc0b11dbed326c1f8c8ff5a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.293/Dovo-Server-Nightly-0.0.9-nightly.293-linux-x64.tar.gz"
      sha256 "b33dc4b852be5dec22d8065e44dd0667b9223f37b478af910340241e93bbfb96"
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
