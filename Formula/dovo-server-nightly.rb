class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.795"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.795/Dovo-Server-Nightly-0.0.9-nightly.795-macos-arm64.tar.gz"
      sha256 "b0c81e5f02c522ac4ecea26c876294e71425c8621c08473648063c085c1ef571"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.795/Dovo-Server-Nightly-0.0.9-nightly.795-linux-arm64.tar.gz"
      sha256 "6f066d81e8b3d7f29af8b96243bdf98e2f71e9ec316e5a322da5d63029aec929"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.795/Dovo-Server-Nightly-0.0.9-nightly.795-linux-x64.tar.gz"
      sha256 "f94a80d877a6f178d559aba7903c2bb6b77b39cc310baa53d66f98f5748e7606"
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
