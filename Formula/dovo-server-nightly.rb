class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.604"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.604/Dovo-Server-Nightly-0.0.9-nightly.604-macos-arm64.tar.gz"
      sha256 "cfcdb8f72ee4b707d0d7c8b943fb603037cf570e13a180eaf0583fa0f19a3441"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.604/Dovo-Server-Nightly-0.0.9-nightly.604-linux-arm64.tar.gz"
      sha256 "b883ddc6c27dabd4a528d9804e86010b996b24ce5ff4aa8a5add634b6e47f9b1"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.604/Dovo-Server-Nightly-0.0.9-nightly.604-linux-x64.tar.gz"
      sha256 "342f4aaf7c401b5e90c259b4789450ec60c45af44a3e8796ee44f7f4e3c291f0"
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
