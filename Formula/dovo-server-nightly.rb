class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.850"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.850/Dovo-Server-Nightly-0.0.9-nightly.850-macos-arm64.tar.gz"
      sha256 "617dd263bc01d4319e0805538614cb48c285a7de2d6e2608c418a473061e9fdd"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.850/Dovo-Server-Nightly-0.0.9-nightly.850-linux-arm64.tar.gz"
      sha256 "07c2e5c140acc4fb1d90c27676e97cb73a17c2f9563afe4502434b9f4acf6a6c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.850/Dovo-Server-Nightly-0.0.9-nightly.850-linux-x64.tar.gz"
      sha256 "59fa32d29b5baf8d4e032bbeab4ff59b857b44a1191de49601fd966cb113a4ae"
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
