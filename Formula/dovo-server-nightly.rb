class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.835"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.835/Dovo-Server-Nightly-0.0.9-nightly.835-macos-arm64.tar.gz"
      sha256 "e56b72040f9df9518bd1e0c434d6137fe9303dde4a3854e61c3b9f0d9b413b3a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.835/Dovo-Server-Nightly-0.0.9-nightly.835-linux-arm64.tar.gz"
      sha256 "036bb952b360a674c7c1e252a8c58ee482fa8db79578d9fe3ad40be6cd9c6f68"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.835/Dovo-Server-Nightly-0.0.9-nightly.835-linux-x64.tar.gz"
      sha256 "2830271fa061e9bbbac088cde77653d7c5c02a418d3c4e9d269fa843c65bb653"
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
