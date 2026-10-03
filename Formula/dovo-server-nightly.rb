class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.182"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.182/Dovo-Server-Nightly-0.0.7-nightly.182-macos-arm64.tar.gz"
      sha256 "4ffeffa2842ff6d994b656b6f08a724a5dc791b34cc6e6a7b08e328b578bc554"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.182/Dovo-Server-Nightly-0.0.7-nightly.182-linux-arm64.tar.gz"
      sha256 "b6f9c917f2a239d3a1392077f2f93ea112a9f92b0881c884c93037656599483e"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.182/Dovo-Server-Nightly-0.0.7-nightly.182-linux-x64.tar.gz"
      sha256 "b8a40dbcd9056f61d47fca3e41849cce79c200e46905e22040020255ce944a0e"
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
