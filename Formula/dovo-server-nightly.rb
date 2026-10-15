class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.320"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.320/Dovo-Server-Nightly-0.0.9-nightly.320-macos-arm64.tar.gz"
      sha256 "d31e958b2a728987173e2c24931c8065c17fb676fe607f6c4bdd53f36290bc7d"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.320/Dovo-Server-Nightly-0.0.9-nightly.320-linux-arm64.tar.gz"
      sha256 "0394efe5c45c9f178593f02526664d67a3af133da6b7a586ec28a35ddc4e71b9"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.320/Dovo-Server-Nightly-0.0.9-nightly.320-linux-x64.tar.gz"
      sha256 "789c63cf3bd00b586dc36173590a8cb4206cbe73d0d84357ee00bc51a343c853"
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
