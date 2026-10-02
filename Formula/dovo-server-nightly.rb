class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.160"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.160/Dovo-Server-Nightly-0.0.7-nightly.160-macos-arm64.tar.gz"
      sha256 "baf458a091fdff90e158e40c13587089ffbca6b4ef77011a420b38da196f8994"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.160/Dovo-Server-Nightly-0.0.7-nightly.160-linux-arm64.tar.gz"
      sha256 "30137d712429552b1acbfaca284019250807298991595990dbab92c409cd72d3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.160/Dovo-Server-Nightly-0.0.7-nightly.160-linux-x64.tar.gz"
      sha256 "67360a855eab60e497dba4f603f6c3f9ff07393a61fe85558968567a4741d5e8"
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
