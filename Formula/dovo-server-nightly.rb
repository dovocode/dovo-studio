class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.351"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.351/Dovo-Server-Nightly-0.0.9-nightly.351-macos-arm64.tar.gz"
      sha256 "fab055493d20a062696304fe30e3f240a2845cf8462d7223b06d1d2cfccd682f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.351/Dovo-Server-Nightly-0.0.9-nightly.351-linux-arm64.tar.gz"
      sha256 "40e05255078be275cbaec491a3c3d74d41d1f7bda4d8abbf15eb438ab860e805"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.351/Dovo-Server-Nightly-0.0.9-nightly.351-linux-x64.tar.gz"
      sha256 "46a56eb215b9cda1befb2bf345ca67836757cb5bed643d3f9fd7f81c0e9334a5"
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
