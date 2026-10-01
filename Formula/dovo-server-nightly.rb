class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.119"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.119/Dovo-Server-Nightly-0.0.7-nightly.119-macos-arm64.tar.gz"
      sha256 "89229c85648b23e796825d9208ce25dd6b89648caab9f8ef7a0138fda1c28c57"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.119/Dovo-Server-Nightly-0.0.7-nightly.119-linux-arm64.tar.gz"
      sha256 "7dc6afe0cffbae40332282e400b96a4db8dfc8b6d963762cab0e3950abcba340"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.119/Dovo-Server-Nightly-0.0.7-nightly.119-linux-x64.tar.gz"
      sha256 "1e1c07e986c991ad87d31be623caf8ff5057da11a05a3e1898dfb6550c515240"
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
