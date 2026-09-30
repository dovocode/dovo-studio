class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.77"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.77/Dovo-Server-Nightly-0.0.7-nightly.77-macos-arm64.tar.gz"
      sha256 "611246cb9b43cf1d7de3e95f5084aee5e937015361ffb0e4b7c6e070ca6a2e4a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.77/Dovo-Server-Nightly-0.0.7-nightly.77-linux-arm64.tar.gz"
      sha256 "81ba8da473d9b7e17038df566698dcd6da82a7a3912c265871010e338d3920b9"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.77/Dovo-Server-Nightly-0.0.7-nightly.77-linux-x64.tar.gz"
      sha256 "6b6221ff8a64db997344cfb4f7e44cd99f3315e931c4c9d65c64ad2f5850d72a"
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
