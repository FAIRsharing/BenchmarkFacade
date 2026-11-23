Running BenchmarkFacade on an Ubuntu workstation

This guide sets up BenchmarkFacade for acceptance testing on your workstation.
You will use it through your normal web browser. No programming or changes to
the application are required.

The start command below makes it accessible
only from this computer. Internet access is still needed: installation downloads
software, and benchmark requests send the resource URL and selected benchmark
to the FAIR Champion service.

One-time setup
==============

You will need your normal Ubuntu account with permission to use sudo, an
internet connection, and a terminal window. Run each command below in order,
waiting for it to finish before entering the next one. Only commands beginning
with sudo need administrator privileges.

1. Install the supporting Ubuntu packages:

    sudo apt update
    sudo apt install git curl gnupg ca-certificates build-essential autoconf bison pkg-config libssl-dev libyaml-dev libreadline-dev zlib1g-dev libffi-dev libgdbm-dev libncurses-dev

These include the tools needed to install Ruby, which runs the application.
Node.js is not needed to use the application; it is only used by the optional
automated JavaScript tests.

2. Install RVM, which manages the application's Ruby installation for your
   account. If you already use RVM, skip the installation commands and continue
   with the source command at the end of this step.

Import the RVM signing keys. Copy the following as one complete line:

    gpg --keyserver keyserver.ubuntu.com --recv-keys 409B6B1796C275462A1703113804BB82D39DC0E3 7D2BAF1CF37B13E2069D6956105BD0E739499BDB

Then install RVM and load it into this terminal:

    curl -fsSL https://get.rvm.io | bash -s stable
    source "$HOME/.rvm/scripts/rvm"

Run these commands as your normal user, without sudo. These instructions use
gpg, which is supplied by the Ubuntu packages installed in step 1.
The RVM installation reference is https://rvm.io/rvm/install.

3. Download the application into your home directory, for example:

    cd ~
    git clone https://github.com/FAIRsharing/BenchmarkFacade.git
    cd BenchmarkFacade

If you already have this directory, use your existing copy instead of cloning
it again. RVM may say that the required Ruby version is not installed when you
enter the directory. The next step installs it.

4. Install and select the application's Ruby version:

    rvm install ruby-4.0.10
    rvm use ruby-4.0.10@benchmark-facade --create

Installation can take several minutes and may display a large amount of
progress information. RVM may request your sudo password to install additional
Ubuntu packages. Wait until the terminal prompt returns before continuing.

The version above matches the application's .ruby-version file. If a later
copy of the application requests a different version, use that version in
both commands.

5. Install the application's supporting Ruby packages:

    gem install bundler -v 4.0.24 --no-document
    bundle install

Wait for the message "Bundle complete!". Do not use sudo for these commands.

Starting and stopping the application
====================================

After setup, while still in the BenchmarkFacade directory, run:

    ./run.sh

Leave the terminal open. The command keeps running while the application is
available; it is normal for the terminal prompt not to return. Once the server
reports that it is listening on port 4567, open this address in a browser on
the same workstation:

    http://127.0.0.1:4567

You should see the home page with a choice of benchmarks. Choose the benchmark
you want to test, enter the full resource URL in its form, and select
"run benchmark".

To stop the application, return to its terminal and press Ctrl+C.

To start it again later, open a terminal and run:

    source "$HOME/.rvm/scripts/rvm"
    cd ~/BenchmarkFacade
    ./run.sh

You do not need to repeat the installation steps for each testing session.
If you put the application elsewhere, use that directory in the cd command.

If something goes wrong
=======================

Stop at the first command that fails. Copy and paste any errors into a local
ChatGPT window with accompanying description.

If the browser cannot connect, check that ./run.sh is still running and that
you are using http://127.0.0.1:4567 on the same workstation. If the terminal
reports that port 4567 is already in use, check whether the application is
already running in another terminal.

If the home page opens but a benchmark fails, record the error shown on the
page and the selected benchmark. Benchmark runs need a working connection to
the FAIR Champion service even though this application runs locally. Any
issues with the FAIR Champion will have to be addressed by the support team.

