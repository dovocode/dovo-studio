class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.115"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.115/Dovo-Server-Nightly-0.0.7-nightly.115-macos-arm64.tar.gz"
      sha256 "0c25473f8cd66e19c61fa561aea87c7e30eb316a10e7335b5ef150102f6ed5c5"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.115/Dovo-Server-Nightly-0.0.7-nightly.115-linux-arm64.tar.gz"
      sha256 "ba17e3b3c63f91274a58043987c403cbf51df558af3de427d1a9f0095ae90ea5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.115/Dovo-Server-Nightly-0.0.7-nightly.115-linux-x64.tar.gz"
      sha256 "e3ee273c38f310af1c392b9048bebe48566ee4b20bd0de57781f5a8f6b8225a9"
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
