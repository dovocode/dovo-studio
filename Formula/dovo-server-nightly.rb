class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.95"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.95/Dovo-Server-Nightly-0.0.7-nightly.95-macos-arm64.tar.gz"
      sha256 "fa0dc309971ce1a674d8631bc3d2f6f4b41affe881c248749c146ce01abdb814"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.95/Dovo-Server-Nightly-0.0.7-nightly.95-linux-arm64.tar.gz"
      sha256 "570945b0318c40034762a37f1eebd9a83396b2b49bd637bc951f42fea907156a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.95/Dovo-Server-Nightly-0.0.7-nightly.95-linux-x64.tar.gz"
      sha256 "4637ce967f857267fcbae45daf0ba735e7afb657f89bdbc37c0ecb83e268e839"
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
