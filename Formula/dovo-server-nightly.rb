class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.191"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.191/Dovo-Server-Nightly-0.0.7-nightly.191-macos-arm64.tar.gz"
      sha256 "51e9837edfd14355259d01fee08f48468290c14f8ae3248f338a928fe4ca0e39"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.191/Dovo-Server-Nightly-0.0.7-nightly.191-linux-arm64.tar.gz"
      sha256 "93472ad70f3d415692b10a45f563b02aaaad62a20f5cbe620a56a27093400e52"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.191/Dovo-Server-Nightly-0.0.7-nightly.191-linux-x64.tar.gz"
      sha256 "bf38a12e45a8c8236fbb0c62c9bef98af0d4b0ad5ba3f09e41efc5cf6ab6adf9"
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
