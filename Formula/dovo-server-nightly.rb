class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1058"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1058/Dovo-Server-Nightly-0.0.9-nightly.1058-macos-arm64.tar.gz"
      sha256 "5d0438384f6ae846659ed70c0f6c94ad952d895e7cf9809703b0f89c5a7dfeb7"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1058/Dovo-Server-Nightly-0.0.9-nightly.1058-linux-arm64.tar.gz"
      sha256 "6b33dd2e45e34adba8074cd35dbfe0fbb4e5d9c93da652dcf1737b2a714751e1"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1058/Dovo-Server-Nightly-0.0.9-nightly.1058-linux-x64.tar.gz"
      sha256 "8dffec2528f4b805e5469b9d9964999faac858e485db43d93579aa03e83304b5"
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
