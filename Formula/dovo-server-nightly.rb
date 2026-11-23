class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1062"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1062/Dovo-Server-Nightly-0.0.9-nightly.1062-macos-arm64.tar.gz"
      sha256 "e6ed826077b480465a53d66613ad113b96066c6b114295f7f5f42701063418ab"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1062/Dovo-Server-Nightly-0.0.9-nightly.1062-linux-arm64.tar.gz"
      sha256 "a42f1c6441f37fe4cfcb0d0fa177d0446d10b21073512fbbdcc2c3f255d67218"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1062/Dovo-Server-Nightly-0.0.9-nightly.1062-linux-x64.tar.gz"
      sha256 "fe08efb25980f5a638eb99e11504dc333d01febe44fd30327125beccd208006b"
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
