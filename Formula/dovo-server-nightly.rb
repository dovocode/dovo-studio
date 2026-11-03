class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.678"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.678/Dovo-Server-Nightly-0.0.9-nightly.678-macos-arm64.tar.gz"
      sha256 "224250d2fb8ed2ae4aa0bdc755e812c9ac74b70bc0b5d2e8c153ea40c8239dab"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.678/Dovo-Server-Nightly-0.0.9-nightly.678-linux-arm64.tar.gz"
      sha256 "03d8e439d0471eb6d06af906fb34ef77b56b9446a02144596b09f85c7aa926a5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.678/Dovo-Server-Nightly-0.0.9-nightly.678-linux-x64.tar.gz"
      sha256 "1c09d54a49510e00d54f188d42e7191d899e5b3134a703e934da55b510b82efd"
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
