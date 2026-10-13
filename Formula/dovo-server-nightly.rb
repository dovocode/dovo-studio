class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.299"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.299/Dovo-Server-Nightly-0.0.9-nightly.299-macos-arm64.tar.gz"
      sha256 "d1d5281d50c6724608206ea8a28a300fcd45ce740ca4dfb0736ef60af17171f4"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.299/Dovo-Server-Nightly-0.0.9-nightly.299-linux-arm64.tar.gz"
      sha256 "a238ea65cb5b5f12324bbbe5bc25369379b93fe98b2fa70d6de2748bd88293d5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.299/Dovo-Server-Nightly-0.0.9-nightly.299-linux-x64.tar.gz"
      sha256 "10bb416130e3c31f35a8591ac1c40d7445df23321b07090865821c4ac9b31d09"
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
