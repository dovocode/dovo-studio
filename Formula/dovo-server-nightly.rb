class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.262"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.262/Dovo-Server-Nightly-0.0.9-nightly.262-macos-arm64.tar.gz"
      sha256 "304cc707f768cd8c3d1d9a7eab96701215729b06739c37b13ab4485516909f44"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.262/Dovo-Server-Nightly-0.0.9-nightly.262-linux-arm64.tar.gz"
      sha256 "be2dfeb241b244f6233cd370789e390f1fc89f80df148a390bcd3c99f67107bb"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.262/Dovo-Server-Nightly-0.0.9-nightly.262-linux-x64.tar.gz"
      sha256 "d1dc80a169c99e4bb9db2ffb03a85c0ba858aa895c7cde5e97f5dd2169cdb5b7"
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
