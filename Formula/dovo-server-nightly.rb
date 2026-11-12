class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.829"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.829/Dovo-Server-Nightly-0.0.9-nightly.829-macos-arm64.tar.gz"
      sha256 "6aa079757865ace671cfc0a0f6628140492bddd0031522d89d0ad1228fa33744"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.829/Dovo-Server-Nightly-0.0.9-nightly.829-linux-arm64.tar.gz"
      sha256 "dddbd423fea35d461413ce56315b36d4e6efc4ea294e0bad37300fbb5152dbd3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.829/Dovo-Server-Nightly-0.0.9-nightly.829-linux-x64.tar.gz"
      sha256 "66928148462a18b0c775e9a0592890b3edd36c2f106b9634f9fb1624ca4a7696"
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
