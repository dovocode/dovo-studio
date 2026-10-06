class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.233"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.233/Dovo-Server-Nightly-0.0.9-nightly.233-macos-arm64.tar.gz"
      sha256 "1e5dd5637d30c193f32d3fb334ecbeda9d0051c7afacb551331e799478df1aa9"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.233/Dovo-Server-Nightly-0.0.9-nightly.233-linux-arm64.tar.gz"
      sha256 "b00a3f18de80f548617f0d96c3ebf263cb3ffdc07b4ce8bf92dddb2574737579"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.233/Dovo-Server-Nightly-0.0.9-nightly.233-linux-x64.tar.gz"
      sha256 "6d6bd22f9b0e11528eddc389157bb0aa9de3494bbf5c4a95ca31a597b43f231c"
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
