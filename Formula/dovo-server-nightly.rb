class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.81"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.81/Dovo-Server-Nightly-0.0.7-nightly.81-macos-arm64.tar.gz"
      sha256 "04ea077ac8293f9d09e0bcf17f7921d4d79930569315febeb1253f839fe4430f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.81/Dovo-Server-Nightly-0.0.7-nightly.81-linux-arm64.tar.gz"
      sha256 "22823f2ec14586f1c930fd4cfa2e3ebde70c2536f9d5eb32724f1344a5421871"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.81/Dovo-Server-Nightly-0.0.7-nightly.81-linux-x64.tar.gz"
      sha256 "e3850e729db6ab5547940fd30532e6ff6ec4800159cc4b1c78856cf64265e564"
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
