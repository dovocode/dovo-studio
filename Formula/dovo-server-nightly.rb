class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1109"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1109/Dovo-Server-Nightly-0.0.9-nightly.1109-macos-arm64.tar.gz"
      sha256 "c3689d93e4cef573ee5cf02bd42f6d31092fe271c2fc7443e6c05dd17d52fcb4"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1109/Dovo-Server-Nightly-0.0.9-nightly.1109-linux-arm64.tar.gz"
      sha256 "911164227b89b5d5dea8d5b92a9bdf1ac4b2d2bb2fbfafb828d809a338ac910d"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1109/Dovo-Server-Nightly-0.0.9-nightly.1109-linux-x64.tar.gz"
      sha256 "6deeea14e3cf53fea5994981a644f162e2cf90a1c87677617a2cc3cac08333fb"
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
