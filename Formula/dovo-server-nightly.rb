class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.68"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.68/Dovo-Server-Nightly-0.0.7-nightly.68-macos-arm64.tar.gz"
      sha256 "0f2b5bc1498d3139dbe2fef8204d36335f3d50b750b42b9a202ca0c55a8a3bde"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.68/Dovo-Server-Nightly-0.0.7-nightly.68-linux-arm64.tar.gz"
      sha256 "b3175ebfbff1b7cea50b15c92b1b78e313c87de47fa7054e9a3a5d7b803967ce"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.68/Dovo-Server-Nightly-0.0.7-nightly.68-linux-x64.tar.gz"
      sha256 "de7b9f29a64054d65cc516f7a4c81f208accd12b444f120a29f15d4fc04a01df"
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
