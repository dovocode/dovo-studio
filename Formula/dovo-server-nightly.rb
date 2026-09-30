class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.89"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.89/Dovo-Server-Nightly-0.0.7-nightly.89-macos-arm64.tar.gz"
      sha256 "1a03f0d44991f16fe34127026803fc13b23c73ffba0aa548d06ee7e91176ec62"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.89/Dovo-Server-Nightly-0.0.7-nightly.89-linux-arm64.tar.gz"
      sha256 "c3789b8860ec1dcf685979a3cacef95c9383525f6e54ed52503f915d320f175e"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.89/Dovo-Server-Nightly-0.0.7-nightly.89-linux-x64.tar.gz"
      sha256 "5b450ee37b954d0c9367d43c2e1b5bba4e31a9290d4bab356457e99f514d65ce"
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
