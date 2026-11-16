class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.918"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.918/Dovo-Server-Nightly-0.0.9-nightly.918-macos-arm64.tar.gz"
      sha256 "3c075447b3ed3d541370ff676c0dfb9e7742635895c4e5696661bb659da3470f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.918/Dovo-Server-Nightly-0.0.9-nightly.918-linux-arm64.tar.gz"
      sha256 "7fe9e62d021582a7c70a392067c00311cd106def7f812968f372d0cf322b0889"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.918/Dovo-Server-Nightly-0.0.9-nightly.918-linux-x64.tar.gz"
      sha256 "fb8b0483e343b03ec6e91b611bda51a228895db90f8ee0c51cd3bc1c07deae55"
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
