class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.924"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.924/Dovo-Server-Nightly-0.0.9-nightly.924-macos-arm64.tar.gz"
      sha256 "97fa57af4db45ac2aad0f41ac95e34401c8dd387986f6b5edda79dbf2c4adc67"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.924/Dovo-Server-Nightly-0.0.9-nightly.924-linux-arm64.tar.gz"
      sha256 "f5c57b243a88eb3359d5c88ec6ff947f1d46b66e06704831c70d94063e239d2a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.924/Dovo-Server-Nightly-0.0.9-nightly.924-linux-x64.tar.gz"
      sha256 "519db94755bc35aa5a0cb1e92219adeb62dc694391aa35a342e00495a7c942c8"
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
