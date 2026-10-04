class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.205"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.205/Dovo-Server-Nightly-0.0.7-nightly.205-macos-arm64.tar.gz"
      sha256 "c06382f58d01ac2c3d04d946ebed21d7524dd78a6576ee4e43e088de1a5509de"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.205/Dovo-Server-Nightly-0.0.7-nightly.205-linux-arm64.tar.gz"
      sha256 "2e77b12f72ecd1df5c8b8e67be004270f70a3e44fbf7cae056e8b8967bced8f2"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.205/Dovo-Server-Nightly-0.0.7-nightly.205-linux-x64.tar.gz"
      sha256 "432223233bdc2d06d6a508594e7b9c805a2d220c1c1ee556b902b55bbd57238c"
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
