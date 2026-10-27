class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.537"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.537/Dovo-Server-Nightly-0.0.9-nightly.537-macos-arm64.tar.gz"
      sha256 "1e2b8c8d81a0449861d726ce3ed64ce46512b543b7d6e77a0e45f8a76a23c1a2"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.537/Dovo-Server-Nightly-0.0.9-nightly.537-linux-arm64.tar.gz"
      sha256 "f2deb12cc611134c93f580b2ec6c83441eb140c0da0a21951dfda5ae8536fc3a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.537/Dovo-Server-Nightly-0.0.9-nightly.537-linux-x64.tar.gz"
      sha256 "6c92a840281190969affb532456d827498582d85d1eaac6a6eed7a2df91ed5ae"
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
