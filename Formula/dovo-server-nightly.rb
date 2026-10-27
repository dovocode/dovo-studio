class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.545"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.545/Dovo-Server-Nightly-0.0.9-nightly.545-macos-arm64.tar.gz"
      sha256 "b24dfd75da017327c28a9e36681d7c1f596d42e03bf37dd1430d78443e4251ac"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.545/Dovo-Server-Nightly-0.0.9-nightly.545-linux-arm64.tar.gz"
      sha256 "9388415adf34935cbfa219e4cd22ab9c4f93347843b608ceac73b42a6d462f86"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.545/Dovo-Server-Nightly-0.0.9-nightly.545-linux-x64.tar.gz"
      sha256 "398cbfaf2ae4373b67f23f96c94311429f13a1d9b5f8db5dfed89a01f78578cc"
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
