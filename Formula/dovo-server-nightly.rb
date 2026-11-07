class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.730"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.730/Dovo-Server-Nightly-0.0.9-nightly.730-macos-arm64.tar.gz"
      sha256 "0c511e699dd6f047765435af39e0ab78557e1d43318805980a7e7007bd3e0548"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.730/Dovo-Server-Nightly-0.0.9-nightly.730-linux-arm64.tar.gz"
      sha256 "3b8552390ddc0ff7944a36cfca85177adea3c01dd59a775f8117298049b2827d"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.730/Dovo-Server-Nightly-0.0.9-nightly.730-linux-x64.tar.gz"
      sha256 "302f174c8fd5edc8a2e1f9392e484526a915fb33fcdb4f9383d98b4fc2496137"
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
