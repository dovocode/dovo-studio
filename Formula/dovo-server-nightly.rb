class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1052"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1052/Dovo-Server-Nightly-0.0.9-nightly.1052-macos-arm64.tar.gz"
      sha256 "f00a081411f2f4947a9c84e57ae9d8a373491b590f59ee6909c24bca13828fe4"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1052/Dovo-Server-Nightly-0.0.9-nightly.1052-linux-arm64.tar.gz"
      sha256 "b0e88213a43c95acca3d0ca8fbf9cd0ad97cd98440f2c91cee77ff6165a6274a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1052/Dovo-Server-Nightly-0.0.9-nightly.1052-linux-x64.tar.gz"
      sha256 "aa5e608da59ee4eef9d91b44f29de57d9324ff6b6b03d26d1d8d0c039f757e27"
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
