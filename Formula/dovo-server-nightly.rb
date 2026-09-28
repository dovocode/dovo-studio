class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.27"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.27/Dovo-Server-Nightly-0.0.7-nightly.27-macos-arm64.tar.gz"
      sha256 "b7cbdf9646fbae3b79c866b4e50d990146d9bd52f59d0a742b2a75d0d4d80821"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.27/Dovo-Server-Nightly-0.0.7-nightly.27-linux-arm64.tar.gz"
      sha256 "39cbd8541313b6ef54929b571d4c37f0dcd461589a93efb714072e5879af6e4a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.27/Dovo-Server-Nightly-0.0.7-nightly.27-linux-x64.tar.gz"
      sha256 "77af38b5477331efff0bbdb33bdd81bfa899626a781cc5bfb3b00032cf528bde"
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
