class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.991"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.991/Dovo-Server-Nightly-0.0.9-nightly.991-macos-arm64.tar.gz"
      sha256 "ac232b0ed32e8a282e11afe5ae381070ad0bfd1bfbf743849b3837941c38c517"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.991/Dovo-Server-Nightly-0.0.9-nightly.991-linux-arm64.tar.gz"
      sha256 "f0930b8b41278eb13069490ea1f37f2b2074359edcc5a2e8fef09fd3d2a70765"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.991/Dovo-Server-Nightly-0.0.9-nightly.991-linux-x64.tar.gz"
      sha256 "877a746d7276bf275768907262fbc0e74c58c38b066a3e9c7ab195cbdc3be7a9"
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
