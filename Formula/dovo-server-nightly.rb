class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.455"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.455/Dovo-Server-Nightly-0.0.9-nightly.455-macos-arm64.tar.gz"
      sha256 "7fc0d1096d09615d262d5586fc944e54400584990bc17fd1bbc81314867ae5d5"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.455/Dovo-Server-Nightly-0.0.9-nightly.455-linux-arm64.tar.gz"
      sha256 "3d7b8d1be0618b6155ae008686bf0e8878ed82e3bc0988ff44dfde4052472672"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.455/Dovo-Server-Nightly-0.0.9-nightly.455-linux-x64.tar.gz"
      sha256 "c864bd398f17b25e0fa32690d6e197754330f24168958cb07f21229ba5fa3959"
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
