class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.801"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.801/Dovo-Server-Nightly-0.0.9-nightly.801-macos-arm64.tar.gz"
      sha256 "3042cd7240e51a7a81852c8e19a783dfa73283cef8ad30ff46a41c3bfaafcc5a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.801/Dovo-Server-Nightly-0.0.9-nightly.801-linux-arm64.tar.gz"
      sha256 "cf1fefcb4f90e346c5dff8403d04fcb493f676bd5979e47cfe6f840b44064c9f"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.801/Dovo-Server-Nightly-0.0.9-nightly.801-linux-x64.tar.gz"
      sha256 "6195e0792c80934501994f0fd20baf07bfb63a5246a9da9fe62526f25b5a3aa6"
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
