class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.47"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.47/Dovo-Server-Nightly-0.0.7-nightly.47-macos-arm64.tar.gz"
      sha256 "d557ba573da13ba6e645ade9194b07fa723a74a938244d0f1ec10a123f42cb57"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.47/Dovo-Server-Nightly-0.0.7-nightly.47-linux-arm64.tar.gz"
      sha256 "d1d8b84d2b8ca968c0cb5e90b92027d76556058291dc4b48fc775114f6760044"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.47/Dovo-Server-Nightly-0.0.7-nightly.47-linux-x64.tar.gz"
      sha256 "66da5698a0e10b8f0601954d9da9a2564d002b5b4e904af0a8f238cbc2c68429"
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
