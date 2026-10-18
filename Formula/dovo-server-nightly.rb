class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.381"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.381/Dovo-Server-Nightly-0.0.9-nightly.381-macos-arm64.tar.gz"
      sha256 "5d4a03d9f3c12e35fe9866fa4f84949568ed9f3c7ac788b3102bd03d9eb61b1a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.381/Dovo-Server-Nightly-0.0.9-nightly.381-linux-arm64.tar.gz"
      sha256 "f8a342f53a92bc4ddd2a56abad5f067109fbfb341e3ba5f30c5daa9c7cb26bee"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.381/Dovo-Server-Nightly-0.0.9-nightly.381-linux-x64.tar.gz"
      sha256 "0af1a5fc3c23af1b4f786e50b1961751d7f674f64195981e61c3e61048531d3a"
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
