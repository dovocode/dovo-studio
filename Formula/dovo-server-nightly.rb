class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.890"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.890/Dovo-Server-Nightly-0.0.9-nightly.890-macos-arm64.tar.gz"
      sha256 "8357fb750cdd12dc94ecba46b74a180ac78a957dac40aa1ce125c8acf8b36460"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.890/Dovo-Server-Nightly-0.0.9-nightly.890-linux-arm64.tar.gz"
      sha256 "775a464b233224555bb4e89e82b463f9dc5897547dc4f3c2f5310808f47c8adb"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.890/Dovo-Server-Nightly-0.0.9-nightly.890-linux-x64.tar.gz"
      sha256 "8fd71cd019eeefd1f206afe19d3579b324bbed5697149ea03bb3bb5cce638163"
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
