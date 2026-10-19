class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.393"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.393/Dovo-Server-Nightly-0.0.9-nightly.393-macos-arm64.tar.gz"
      sha256 "1769998ebc1200729c1815e2520e31c47ebedcf0246dc8a699a5106349c383db"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.393/Dovo-Server-Nightly-0.0.9-nightly.393-linux-arm64.tar.gz"
      sha256 "5790121184214334e165485b096e78c842424b649c4e5500e99d27beb330a0ee"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.393/Dovo-Server-Nightly-0.0.9-nightly.393-linux-x64.tar.gz"
      sha256 "3becaf716c6d88884b5a9d0c66a31d49d48e18ab0a2f0d16c09bbc7bbf0c1998"
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
