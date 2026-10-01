class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.138"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.138/Dovo-Server-Nightly-0.0.7-nightly.138-macos-arm64.tar.gz"
      sha256 "3687658ff252e9e068b3a741ff0fd96c98da45e490e2ac345bdeea4c1da29dc2"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.138/Dovo-Server-Nightly-0.0.7-nightly.138-linux-arm64.tar.gz"
      sha256 "178b50f924cd6f2ef23a35ab47c4604a4bd77cbbb8225a79ec25c3b5edb7d3b2"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.138/Dovo-Server-Nightly-0.0.7-nightly.138-linux-x64.tar.gz"
      sha256 "ce61ec450a790210d9a811e3b98d0577a85a6fabd2454dbdb428624802b98253"
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
