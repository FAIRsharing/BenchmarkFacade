# Render the existing Sinatra views as static pages. Ruby is used only at build
# time; Netlify serves these files and executes the JavaScript API function.
require "erb"
require "digest"
require "fileutils"
require "rack/utils"
require_relative "../config/benchmarks"

class NetlifyPages
  ROOT = File.expand_path("..", __dir__)

  def initialize
    @benchmarks = BENCHMARKS
    @static_build = true
    @guid = ""
  end

  def build
    output = File.join(ROOT, "dist")
    FileUtils.mkdir_p(output)
    FileUtils.cp_r(File.join(ROOT, "public", "."), output)
    File.write(File.join(output, "index.html"), page("index"))
    @benchmarks.each do |operation, config|
      @operation, @config = operation, config
      directory = File.join(output, operation)
      FileUtils.mkdir_p(directory)
      File.write(File.join(directory, "index.html"), page("run_benchmark"))
    end
    File.write(File.join(output, "404.html"), layout { '<h1>Page not found</h1><p><a href="/">Choose a benchmark</a></p>' })
    puts "Built Netlify pages in #{output}"
  end

  private

  def asset_path(path)
    version = Digest::SHA256.file(File.join(ROOT, "public", path.delete_prefix("/"))).hexdigest[0, 12]
    "#{path}?v=#{version}"
  end

  def page(name)
    content = ERB.new(File.read(File.join(ROOT, "views", "#{name}.erb"))).result(binding)
    layout { content }
  end

  def layout
    ERB.new(File.read(File.join(ROOT, "views", "layout.erb"))).result(binding)
  end
end

NetlifyPages.new.build if $PROGRAM_NAME == __FILE__
