class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.39"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.39/Dovo-Server-Nightly-0.0.7-nightly.39-macos-arm64.tar.gz"
      sha256 "1270e33971437eceb41f5eac6eb79ee73120902912a48f6df5ab645f4fe54de8"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.39/Dovo-Server-Nightly-0.0.7-nightly.39-linux-arm64.tar.gz"
      sha256 "e00ebf04b198532cb02d03c62c888b743348119f823c139b98617535b0743947"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.39/Dovo-Server-Nightly-0.0.7-nightly.39-linux-x64.tar.gz"
      sha256 "1921810e252be228de79165f30ad6a367090c2793312f2578b801c19712f955c"
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
