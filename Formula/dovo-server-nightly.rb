class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.245"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.245/Dovo-Server-Nightly-0.0.9-nightly.245-macos-arm64.tar.gz"
      sha256 "8588440c8aae3fb124ef28c5fb79dfe9b228fc8a17c2c6c5b53e9bb18cedcad6"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.245/Dovo-Server-Nightly-0.0.9-nightly.245-linux-arm64.tar.gz"
      sha256 "cd7a6b097dfa6099b8a080599f4206e624131c5bb0cb0584574267fd90e17c15"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.245/Dovo-Server-Nightly-0.0.9-nightly.245-linux-x64.tar.gz"
      sha256 "540b80679a7c79c13b7e45257f5b6b47aded0558a490966727b03cf76c566e32"
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
