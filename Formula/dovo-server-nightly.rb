class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.668"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.668/Dovo-Server-Nightly-0.0.9-nightly.668-macos-arm64.tar.gz"
      sha256 "1d25d93f86d01ceaf803ea1970715fc71afd7955c24ef3bd37b044c4db4bed58"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.668/Dovo-Server-Nightly-0.0.9-nightly.668-linux-arm64.tar.gz"
      sha256 "bf0cadfcb4723c10f74f2771663e761e962124e5cbe16477f6c22efdf2ab2dc1"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.668/Dovo-Server-Nightly-0.0.9-nightly.668-linux-x64.tar.gz"
      sha256 "57f8dc632b8ba6c4f841ceac5f4ca8f4bdb5a524badb811c0691a0115b04eac4"
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
