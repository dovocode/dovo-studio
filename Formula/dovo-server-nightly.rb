class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.23"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.23/Dovo-Server-Nightly-0.0.7-nightly.23-macos-arm64.tar.gz"
      sha256 "05581cf666037aa5505b98b0dfc3e0cf035338f2737d48c3ddb11478d033a7ec"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.23/Dovo-Server-Nightly-0.0.7-nightly.23-linux-arm64.tar.gz"
      sha256 "bd44febbbcf935419a7c1b661f8c10b03e6cca354d47166e01676f0ac65fc945"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.23/Dovo-Server-Nightly-0.0.7-nightly.23-linux-x64.tar.gz"
      sha256 "8b719610ef9113794f55e26530618a1a2189e1f36274092b7ae4897a2da265d6"
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
