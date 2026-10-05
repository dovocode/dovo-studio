class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.229"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.229/Dovo-Server-Nightly-0.0.9-nightly.229-macos-arm64.tar.gz"
      sha256 "db139380b6012137ea60eed4fb3fc9e8fef65cbd65047265d681296fe03d42bf"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.229/Dovo-Server-Nightly-0.0.9-nightly.229-linux-arm64.tar.gz"
      sha256 "fb1f9a803dc396661ad448a01f99c5a831c7e49a9cc83ef5701376e0307ee1e8"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.229/Dovo-Server-Nightly-0.0.9-nightly.229-linux-x64.tar.gz"
      sha256 "4b3faa452e27fafd8a098f2dc857d3bdfd73ea7b67f55efa3d8246f4ddc5b135"
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
