class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.638"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.638/Dovo-Server-Nightly-0.0.9-nightly.638-macos-arm64.tar.gz"
      sha256 "4e45642a848289e6ed98211955551710578f23d64f5bad95ecb27e6d0ee57f6e"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.638/Dovo-Server-Nightly-0.0.9-nightly.638-linux-arm64.tar.gz"
      sha256 "1972d39798ab94868021b0487231d1e647cc8e16e6c464f01ee9b624f3255767"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.638/Dovo-Server-Nightly-0.0.9-nightly.638-linux-x64.tar.gz"
      sha256 "2afbc70fd94200caefd05ae493d914778beab00c8f8556f1f6e2953c458e0ac9"
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
