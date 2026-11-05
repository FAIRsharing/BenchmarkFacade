require "rake/testtask"

Rake::TestTask.new("test:ruby") do |task|
  task.libs << "tests"
  task.pattern = "tests/**/*_test.rb"
end

namespace :test do
  desc "Run JavaScript tests using Node.js when available"
  task :javascript do
    system("node", "--test", *FileList["tests/javascript/**/*_test.cjs"], exception: true)
  rescue Errno::ENOENT
    warn "WARNING: Node.js (node) was not found; skipping JavaScript tests. Ruby tests still run."
  end
end

desc "Run Ruby and JavaScript tests"
task test: ["test:ruby", "test:javascript"]

task default: :test
