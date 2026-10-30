class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.595"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.595/Dovo-Server-Nightly-0.0.9-nightly.595-macos-arm64.tar.gz"
      sha256 "0e7d05e8e70eb5913d32619f7c60938d60e18fc833d8b238a61ba95c8ad981e9"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.595/Dovo-Server-Nightly-0.0.9-nightly.595-linux-arm64.tar.gz"
      sha256 "ea240e74adc8a69fed8a27079b4ee65def5e33548cf65d0281f6680fbb40de61"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.595/Dovo-Server-Nightly-0.0.9-nightly.595-linux-x64.tar.gz"
      sha256 "89e9a11dfad47e2bc0243085ee96b9f4da7af766f5c3176c4964188d97d15564"
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
