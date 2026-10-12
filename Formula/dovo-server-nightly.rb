class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.297"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.297/Dovo-Server-Nightly-0.0.9-nightly.297-macos-arm64.tar.gz"
      sha256 "c107bb9ea45d81dceb11e095f8c257c895ba2f6e5fe34ec3c73505c8a8584645"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.297/Dovo-Server-Nightly-0.0.9-nightly.297-linux-arm64.tar.gz"
      sha256 "16ae5ceaa3f8701e0abe7fb88db99675bdc5fce042a3db382b8a7922a060b321"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.297/Dovo-Server-Nightly-0.0.9-nightly.297-linux-x64.tar.gz"
      sha256 "0d58d067af2e626ca7d1feea40a0eb8b0fd1c71f942aa2e0b06308794af7197c"
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
