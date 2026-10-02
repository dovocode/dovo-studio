class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.146"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.146/Dovo-Server-Nightly-0.0.7-nightly.146-macos-arm64.tar.gz"
      sha256 "54857afd93b5c805b371c616d3db4c7e09c06d139871c9e5aa19b9b2ad8f2ecb"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.146/Dovo-Server-Nightly-0.0.7-nightly.146-linux-arm64.tar.gz"
      sha256 "811d6805a7cf1e5827f6a127008178e1ecbda2d7271f4466bc0bf109f04370a0"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.146/Dovo-Server-Nightly-0.0.7-nightly.146-linux-x64.tar.gz"
      sha256 "75e5ffaeec2e00cbc8cb056c5ea050bacadb8b1424c6c3cae10e199e225c8f87"
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
