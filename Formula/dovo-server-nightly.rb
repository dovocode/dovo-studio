class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.910"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.910/Dovo-Server-Nightly-0.0.9-nightly.910-macos-arm64.tar.gz"
      sha256 "b7c6290bc14507358afb0a13255b263164de3ee2fd05e5fd40760502957dffdd"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.910/Dovo-Server-Nightly-0.0.9-nightly.910-linux-arm64.tar.gz"
      sha256 "741edd8f9c48a6be0eb084aaeb163c94683e1bd5aef071e823412743be72bfa3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.910/Dovo-Server-Nightly-0.0.9-nightly.910-linux-x64.tar.gz"
      sha256 "3ee30c21e8c64923a2439e5a2e6ef50d35bd9c75f16d9c1756e7323fbf19e872"
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
